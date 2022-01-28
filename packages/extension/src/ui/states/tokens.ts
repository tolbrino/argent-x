import { BigNumber } from "ethers"
import { useEffect, useMemo } from "react"
import useSWR from "swr"
import create from "zustand"
import { persist } from "zustand/middleware"

import erc20Tokens from "../../assets/erc20-tokens.json"
import { messageStream } from "../../shared/messages"
import { isValidAddress } from "../utils/addresses"
import { fetchTokenBalance } from "../utils/tokens"
import { useAccount } from "./account"
import { useAppState } from "./app"

export interface TokenDetails {
  address: string
  name?: string
  symbol?: string
  decimals?: BigNumber
  networkId: string
}

const equalToken = (a: TokenDetails, b: TokenDetails) =>
  a.address === b.address && a.networkId === b.networkId

const parsedDefaultErc20Tokens = erc20Tokens.map((token) => ({
  ...token,
  decimals: BigNumber.from(token.decimals),
  networkId: token.network,
}))

interface TokenState {
  tokens: TokenDetails[]
  addToken: (token: TokenDetails) => void
  removeToken: (token: TokenDetails) => void
}

export const useTokens = create<TokenState>(
  persist(
    (set, get) => ({
      tokens: parsedDefaultErc20Tokens,
      addToken: (token: TokenDetails) => {
        if (!isValidAddress(token.address)) {
          throw Error("token address malformed")
        }
        if (get().tokens.find((t) => equalToken(t, token))) {
          throw Error("token already added")
        }
        set((state) => ({ tokens: [...state.tokens, token] }))
      },
      removeToken: (token: TokenDetails) => {
        set((state) => ({
          tokens: state.tokens.filter((t) => t.address !== token.address),
        }))
      },
    }),
    {
      name: "tokens", // name of item in the storage (must be unique)
      getStorage: () => localStorage, // (optional) by default the 'localStorage' is used
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...persistedState,
        tokens: [...currentState.tokens, ...persistedState.tokens],
      }),
      partialize: (state) =>
        Object.fromEntries(
          Object.entries(state).map(([key, value]) => {
            if (key === "tokens") {
              return [
                key,
                (value as TokenDetails[]).filter(
                  (token) =>
                    !parsedDefaultErc20Tokens.some((defaultToken) =>
                      equalToken(token, defaultToken),
                    ),
                ),
              ]
            }
            return [key, value]
          }),
        ),
      deserialize: (str) =>
        JSON.parse(str, (_, v) => {
          if (
            typeof v === "object" &&
            "type" in v &&
            "hex" in v &&
            v.type === "BigNumber"
          ) {
            return BigNumber.from(v.hex)
          }
          return v
        }),
    },
  ),
)

export const addToken = (token: TokenDetails) => {
  useTokens.getState().addToken(token)
}

export const selectTokensByNetwork =
  (networkId: string) => (state: TokenState) =>
    state.tokens.filter((token) => token.networkId === networkId)

export interface TokenDetailsWithBalance extends TokenDetails {
  balance?: BigNumber
}

interface UseTokens {
  tokenDetails: TokenDetailsWithBalance[]
  isValidating: boolean
  error?: any
}

export const useTokensWithBalance = (): UseTokens => {
  const { switcherNetworkId } = useAppState()
  const { selectedWallet } = useAccount()
  const tokensInNetwork = useTokens(selectTokensByNetwork(switcherNetworkId))
  const tokenAddresses = useMemo(
    () => tokensInNetwork.map((t) => t.address),
    [tokensInNetwork],
  )

  const { data, isValidating, error, mutate } = useSWR(
    [selectedWallet, ...tokenAddresses],
    async (walletAddress, ...tokenAddresses) => {
      if (!walletAddress) {
        return {}
      }
      const balances = await Promise.all(
        tokenAddresses.map(async (address) =>
          fetchTokenBalance(address, walletAddress, switcherNetworkId),
        ),
      )
      return balances.reduce((acc, balance, i) => {
        return {
          ...acc,
          [tokenAddresses[i]]: balance,
        }
      }, {} as Record<string, BigNumber>)
    },
    { suspense: true, refreshInterval: 30000 },
  )

  // refetch balances on transaction success
  useEffect(() => {
    const sub = messageStream.subscribe(([msg]) => {
      if (msg.type === "TRANSACTION_SUCCESS") {
        mutate() // refetch balances
      }
    })
    return () => {
      if (!sub.closed) {
        sub.unsubscribe()
      }
    }
  }, [mutate])

  const tokenDetails = useMemo(() => {
    return tokensInNetwork.map((token) => ({
      ...token,
      balance: data?.[token.address],
    }))
  }, [tokenAddresses, data])

  return { tokenDetails, isValidating, error }
}