import "dotenv/config";
import ynab from "ynab";

const ynabAPI = new ynab.API(process.env.YNAB_TOKEN);

const YNAB_ACCEPTABLE_DOLLAR_DIFFERENCE = process.env
  .YNAB_ACCEPTABLE_DOLLAR_DIFFERENCE
  ? parseFloat(process.env.YNAB_ACCEPTABLE_DOLLAR_DIFFERENCE)
  : 0.5;

const YNAB_ACCEPTABLE_DATE_DIFFERENCE = process.env
  .YNAB_ACCEPTABLE_DATE_DIFFERENCE
  ? parseFloat(process.env.YNAB_ACCEPTABLE_DATE_DIFFERENCE)
  : 4;

export default class YNAB {
  budget = null;
  transactionsServerKnowledge = undefined;
  transactions = {}; // TODO: does not get updated on memo updates

  init = async () => {
    console.log("Connecting to YNAB...");

    const budgetsResponse = await ynabAPI.budgets.getBudgets();
    const budget = budgetsResponse.data.budgets.find(
      (b) => b.id === process.env.YNAB_BUDGET_ID
    );

    if (!budget)
      throw new Error(
        "Invalid budget ID provided. You can find the budget ID in the URL of your budget page."
      );

    this.budget = budget;
  };

  getCachedTransactionCount = () => Object.keys(this.transactions).length;

  fetchTransactions = async (sinceDate = undefined) => {
    const { transactions, server_knowledge } = (
      await ynabAPI.transactions.getTransactions(
        this.budget.id,
        sinceDate ? sinceDate.toISOString().split("T")[0] : undefined,
        undefined,
        this.transactionsServerKnowledge
      )
    ).data;

    this.transactionsServerKnowledge = server_knowledge;

    let newTransactionsCount = 0;
    transactions
      .filter(
        (t) =>
          t.payee_name.toLowerCase().includes("amazon") &&
          (typeof t.memo !== "string" || t.memo.length == 0)
      )
      .forEach((t) => {
        if (t.deleted && t.id in this.transactions)
          delete this.transactions[t.id];
        else {
          this.transactions[t.id] = t;
          newTransactionsCount++;
        }
      });

    console.info(
      `Cached ${newTransactionsCount} historical Amazon transactions from YNAB (pending memo)`
    );
  };

  matchTransactions = (orders) => {
    if (orders.length === 0) return;

    let nearOrPerfectMatches = [];

    orderLoop: for (const [orderIndex, order] of orders.entries()) {
      for (const [transactionId, transaction] of Object.entries(
        this.transactions
      )) {
        if (transaction.memo && transaction.memo.length > 0) continue;

        const dateDifference = Math.abs(
          order.date - new Date(transaction.date)
        );
        const priceDifference = Math.abs(
          Math.abs(order.amount) - Math.abs(transaction.amount)
        );
        if (
          dateDifference <= YNAB_ACCEPTABLE_DATE_DIFFERENCE * 86400 * 1000 &&
          priceDifference <= YNAB_ACCEPTABLE_DOLLAR_DIFFERENCE * 1000
        )
          nearOrPerfectMatches.push({
            dateDifference,
            priceDifference,
            orderIndex,
            transactionId,
          });

        // If perfect match, no sense in continuing the search for this order
        if (dateDifference === 0 && priceDifference === 0) continue orderLoop;
      }
    }

    nearOrPerfectMatches.sort((a, b) => {
      // First, compare by the "dateDifference" property in ascending order
      if (a.dateDifference < b.dateDifference) return -1;
      if (a.dateDifference > b.dateDifference) return 1;

      // If the "dateDifference" values are equal, compare by "priceDifference" in ascending order
      if (a.priceDifference < b.priceDifference) return -1;
      if (a.priceDifference > b.priceDifference) return 1;

      // If the dates are the same, compare by the "priceDifference" property in descending order
      if (a.priceDifference > b.priceDifference) return -1;
      if (a.priceDifference < b.priceDifference) return 1;

      // If both "date" and "price" are equal, no change in order
      return 0;
    });

    const finalMatches = [];

    while (nearOrPerfectMatches.length > 0) {
      const match = nearOrPerfectMatches.shift();
      nearOrPerfectMatches = nearOrPerfectMatches.filter(
        (potentialMatch) =>
          potentialMatch.transactionId !== match.transactionId &&
          potentialMatch.orderIndex !== match.orderIndex
      );

      finalMatches.push({
        transactionId: match.transactionId,
        order: orders[match.orderIndex],
      });
    }

    console.log(`Found new ${finalMatches.length} YNAB <-> Amazon matches`);
    return finalMatches;
  };

  updateTransactions = async (matches) => {
    if (matches.length === 0) return;
    await ynabAPI.transactions.updateTransactions(this.budget.id, {
      transactions: matches.map((m) => {
        const id = m.transactionId;
        const memo = m.order.items.join(", ");
        this.transactions[id].memo = memo;
        return {
          id,
          memo,
          approved: false,
        };
      }),
    });
    console.log(`Added order details to ${matches.length} Amazon transactions`);
  };
}
