import "dotenv/config";
import IMAP from "node-imap";
import YNAB from "./ynab.js";
import { historicalSearch, watchInbox } from "./mail.js";

const INBOX_NAME = process.env.IMAP_INBOX_NAME || "INBOX";

export const dollarFormat = (amt) =>
  amt.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });

export const dateFormat = (date) =>
  new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

(async () => {
  const ynab = new YNAB();
  await ynab.init();

  const imap = new IMAP({
    user: process.env.IMAP_USERNAME,
    password: process.env.IMAP_PASSWORD,
    host: process.env.IMAP_INCOMING_HOST,
    port: process.env.IMAP_INCOMING_PORT,
    tls: process.env.IMAP_TLS.toLowerCase() === "true",
  });

  imap.once("ready", () => {
    console.log("Successfully connected to mail server!");
    console.log("Opening mailbox...");
    imap.openBox(INBOX_NAME, true, async (err, box) => {
      if (err) throw err;

      const orders = [];

      await historicalSearch(imap, ynab, box, orders);

      console.log("Listening to mailbox for new emails...");

      watchInbox(imap, ynab, box, orders);

      setInterval(async () => {
        try {
          await ynab.fetchTransactions();
          await ynab.matchAndUpdate(orders);
        } catch (e) {
          console.error(e);
        }
      }, 60000);
    });
  });

  imap.once("error", (err) => {
    throw err;
  });

  imap.once("end", (err) => {
    console.log("Mail server connection closed");
    process.exit(1);
  });

  console.log("Connecting to mail server...");
  imap.connect();
})();
