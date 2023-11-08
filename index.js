import "dotenv/config";
import IMAP from "node-imap";
import {
  readEmail,
  isAmazonEmail,
  fetchOrderEmails,
  scanEmail,
} from "./mail.js";
import YNAB from "./ynab.js";

const INBOX_NAME = process.env.INBOX_NAME || "INBOX";
const HISTORICAL_SEARCH_NUM_EMAILS = parseInt(
  process.env.HISTORICAL_SEARCH_NUM_EMAILS
);

(async () => {
  const ynab = new YNAB()
  await ynab.init()

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

      if (HISTORICAL_SEARCH_NUM_EMAILS > 0) {
        console.log(
          `Searching back over last ${HISTORICAL_SEARCH_NUM_EMAILS} emails...`
        );

        const endIndex = box.messages.total;
        const startIndex = endIndex - (HISTORICAL_SEARCH_NUM_EMAILS - 1);
        const fetch = imap.seq.fetch(`${startIndex}:${endIndex}`, {
          bodies: ["HEADER.FIELDS (FROM SUBJECT)"],
          struct: true,
        });

        const emailFetches = [];
        const amazonMsgSeqNums = [];
        let processedEmails = 0;

        fetch.on("message", (imapMsg, seqno) => {
          emailFetches.push(
            new Promise(async (resolve, reject) => {
              try {
                const email = await readEmail(imapMsg, false);
                if (isAmazonEmail(email)) amazonMsgSeqNums.push(seqno);
                processedEmails++;
                console.log(
                  `${processedEmails} emails collected... Limit: ${HISTORICAL_SEARCH_NUM_EMAILS}`
                );
              } catch (e) {
                console.error(e0);
              }
              resolve();
            })
          );
        });

        fetch.on("error", (err) => {
          throw new Error(err);
        });

        fetch.once("end", async () => {
          await Promise.all(emailFetches);

          const amazonEmailCount = amazonMsgSeqNums.length;
          console.info(
            `${amazonEmailCount} Amazon order confirmation emails found`
          );

          const orders = [];

          const emailScans = [];
          amazonMsgSeqNums.forEach((seqno) => {
            emailScans.push(
              new Promise(async (resolve, reject) => {
                try {
                  const [email] = await fetchOrderEmails(
                    imap.seq,
                    seqno,
                    seqno
                  );
                  orders.push(await scanEmail(email));
                } catch (e) {
                  console.error(e);
                }
                resolve();
              })
            );
          });

          await Promise.all(emailScans);

          imap.end();

          console.log("Finished scanning old emails successfully!");

          const unmatchedOrders = await ynab.matchTransactions(orders)
          // await ynab.createTransactions(unmatchedOrders)
        });
      } else {
        console.log("Listening to mailbox for new emails...");

        imap.on("mail", async (newEmailCount) => {
          console.log(`${newEmailCount} new email(s), scanning contents...`);
          const endIndex = box.messages.total;
          const startIndex = endIndex - (newEmailCount - 1);
          try {
            const emails = await fetchOrderEmails(
              imap.seq,
              startIndex,
              endIndex
            );
            for (const email of emails) await scanEmail(email);
          } catch (e) {
            console.error(e);
          }
        });
      }
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
