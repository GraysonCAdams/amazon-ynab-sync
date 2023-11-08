import "dotenv/config";
import ynab from "ynab";

const ynabAPI = new ynab.API(process.env.YNAB_TOKEN);

const YNAB_CREATE_TRANSACTIONS_MERCHANT_NAME =
  process.env.YNAB_CREATE_TRANSACTIONS_MERCHANT_NAME || "Amazon.com";

const YNAB_CREATE_TRANSACTIONS_ACCOUNT_NAME =
  process.env.YNAB_CREATE_TRANSACTIONS_ACCOUNT_NAME;

const YNAB_CREATE_TRANSACTIONS =
  process.env.YNAB_CREATE_TRANSACTIONS.toLowerCase() === "true";

const YNAB_CREATE_TRANSACTIONS_MARK_APPROVED =
  process.env.YNAB_CREATE_TRANSACTIONS_MARK_APPROVED.toLowerCase() === "true";

const YNAB_CREATE_TRANSACTIONS_MARK_CLEARED =
  process.env.YNAB_CREATE_TRANSACTIONS_MARK_CLEARED.toLowerCase() === "true";

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
  newTransactionsAccount = null;

  init = async () => {
    console.log("Connecting to YNAB...");

    const budgetsResponse = await ynabAPI.budgets.getBudgets();
    this.budget = budgetsResponse.data.budgets.find(
      (b) => b.id === process.env.YNAB_BUDGET_ID
    );

    if (!this.budget) {
      console.error(
        "Invalid budget ID provided. You can find the budget ID in the URL of your budget page."
      );
      process.exit(1);
    }

    if (YNAB_CREATE_TRANSACTIONS) {
      try {
        this.newTransactionsAccount = (
          await ynabAPI.accounts.getAccounts(this.budget.id)
        ).data.accounts.find(
          (a) =>
            a.name.toLowerCase() ===
            YNAB_CREATE_TRANSACTIONS_ACCOUNT_NAME.toLowerCase()
        );

        if (!this.newTransactionsAccount) throw new Error();

        console.info(
          `Account has been found. ` +
            `New transactions will be filed under account ${this.newTransactionsAccount.name}`
        );
      } catch (e) {
        console.warn(
          `Unable to locate account "${YNAB_CREATE_TRANSACTIONS_ACCOUNT_NAME}", therefore new transactions cannot be created`
        );
      }
    }
  };

  createTransactions = async (orders) => {
    if (!this.newTransactionsAccount) return;

    const data = {
      account_id: this.newTransactionsAccount.id,
      payee_name: YNAB_CREATE_TRANSACTIONS_MERCHANT_NAME,
    };

    try {
      await ynabAPI.transactions.createTransactions(this.budget.id, {
        transactions: orders
          .filter((order) => order.amount > 0)
          .map((order) => {
            const isoFormatWithTimezone = order.date.toISOString();
            const isoDate = isoFormatWithTimezone.split("T")[0];

            return {
              ...data,
              date: isoDate,
              approved: YNAB_CREATE_TRANSACTIONS_MARK_APPROVED,
              cleared: YNAB_CREATE_TRANSACTIONS_MARK_CLEARED
                ? "cleared"
                : "uncleared",
              amount: order.amount,
              memo: order.items.join(", "),
            };
          }),
      });
    } catch (e) {
      console.error(e);
    }
  };

  matchTransactions = async (orders) => {
    if (orders.length == 0) return [];

    orders = [...orders].sort(function (a, b) {
      return new Date(b.date) - new Date(a.date);
    });

    try {
      const sinceDate = orders
        .slice(-1)[0]
        .date.toISOString()
        .split("T")[0];

      const transactions = (
        await ynabAPI.transactions.getTransactions(this.budget.id, sinceDate)
      ).data.transactions.filter(
        (t) =>
          t.payee_name.toLowerCase().includes("amazon") &&
          typeof t.memo !== "string"
      );

      let nearOrPerfectMatches = [];

      orderLoop: for (const [
        orderIndex,
        order,
      ] of orders.entries()) {
        transactionLoop: for (const [
          transactionIndex,
          transaction,
        ] of transactions.entries()) {
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
              transactionIndex,
            });
          if (dateDifference === 0 && priceDifference === 0)
            continue orderLoop;
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
            potentialMatch.transactionIndex !== match.transactionIndex &&
            potentialMatch.orderIndex !== match.orderIndex
        );

        finalMatches.push({
          transaction: transactions[match.transactionIndex],
          order: orders[match.orderIndex],
        });
      }

      console.log(finalMatches);

      // return orders;
    } catch (e) {
      console.error(e);
    }
  };
}

// export const matchTransaction = (order) => {
//   // Find transactions within 3 days of order, sort by oldest to new
//   // Find transactions matching cost without a memo
//   // Create transaction in specified account name if enabled, otherwise only match or wait for match
// };
