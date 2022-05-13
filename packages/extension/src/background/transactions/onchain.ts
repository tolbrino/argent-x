import { getProvider } from "../../shared/networks"
import { Transaction } from "../../shared/transactions"
import { getTransactionsStatusUpdate } from "./determineUpdates"

export async function getTransactionsUpdate(transactions: Transaction[]) {
  const fetchedTransactions = await Promise.allSettled(
    transactions.map(async (transaction) => {
      const provider = getProvider(transaction.account.network)
      const status = await provider.getTransactionStatus(transaction.hash)
      return {
        ...transaction,
        status: status.tx_status,
        failureReason: status.tx_failure_reason,
      }
    }),
  )

  const updatedTransactions = fetchedTransactions.reduce((acc, transaction) => {
    if (transaction.status === "fulfilled") {
      acc.push(transaction.value)
    }
    return acc
  }, [] as Transaction[])

  return getTransactionsStatusUpdate(transactions, updatedTransactions) // filter out transactions that have not changed
}