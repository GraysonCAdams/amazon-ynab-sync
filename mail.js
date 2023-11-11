import IMAP from "node-imap";
import * as cheerio from "cheerio";
import quotedPrintable from "quoted-printable";
import { dateFormat, dollarFormat } from "./index.js";

const HISTORICAL_SEARCH_NUM_EMAILS = parseInt(
  process.env.HISTORICAL_SEARCH_NUM_EMAILS
);

const isAmazonEmail = ({ subject }) =>
  subject.includes("Your Amazon.com order") &&
  !subject.includes("has shipped") &&
  !subject.includes("has been canceled");

const scanEmail = (email) => {
  const { from, subject, body, attributes } = email;

  if (!isAmazonEmail(email)) {
    console.log(
      "Ignoring... not an Amazon order email (subject or body mismatch)"
    );
    return;
  }

  // Mail forwarding sometimes messes with ID/class attributes,
  // so cleaning up the attributes prefixed with "x_"
  const $ = cheerio.load(body.replace(/"x_/g, '"'));

  try {
    const amount = parseFloat(
      $('table[id$="costBreakdownRight"] td').text().trim().slice(1)
    );

    if (amount === 0) return;

    const items = [];
    const itemRows = $('table[id$="itemDetails"] tr').toArray();
    for (const itemRow of itemRows) {
      // If you're here because you want the item names to be more detailed,
      // I did not find anywhere in the email body that contains the full name
      // for longer item titles
      let title = $(itemRow).find("font").text().trim();
      if (title.endsWith("...")) {
        title = title.split(" ").slice(0, -1).join(" ");
        if (title.endsWith(",")) title = title.slice(0, -1);
        title += "..";
      }
      if (title.length === 0) continue;
      items.push(title);
    }

    if (items.length === 0) return;

    const date = new Date(attributes.date.setHours(0, 0, 0, 0));

    console.info(
      `Found ${dollarFormat(amount)} order on ${dateFormat(date)} of ${
        items.length
      } item(s): ${items.join(", ")}`
    );

    return {
      date,
      amount: -(amount * 1000),
      items,
    };
  } catch (e) {
    console.error(e);
    console.error(`This failed on email with subject: ${subject}`);
  }
};

const readEmail = (imapMsg, readBody = true) =>
  new Promise((resolve, reject) => {
    let headers = null;
    let body = null;
    let attributes = null;
    imapMsg.once("attributes", function (attrs) {
      attributes = attrs;
    });
    imapMsg.on("body", (stream, info) => {
      let buffer = "";
      let count = 0;
      stream.on("data", function (chunk) {
        count += chunk.length;
        buffer += chunk.toString("utf8");
      });
      stream.once("end", function () {
        switch (info.which) {
          case "HEADER.FIELDS (FROM SUBJECT)":
            headers = IMAP.parseHeader(buffer);
            break;
          case "TEXT":
            body = quotedPrintable.decode(buffer.toString());
            break;
        }
      });
    });
    imapMsg.once("end", function (attrs) {
      if (attributes && headers && (!readBody || body)) {
        resolve({
          from: headers.from[0],
          subject: headers.subject[0],
          attributes,
          body,
        });
      } else {
        reject();
      }
    });
  });

const fetchOrderEmails = async (seq, startIndex, endIndex) =>
  new Promise((resolve, reject) => {
    const fetch = seq.fetch(`${startIndex}:${endIndex}`, {
      bodies: ["HEADER.FIELDS (FROM SUBJECT)", "TEXT"],
      struct: true,
    });
    const emails = [];
    fetch.on("message", async (imapMsg) => {
      try {
        const email = await readEmail(imapMsg, true);
        emails.push(email);
      } catch (e) {
        console.error(e);
      }
    });
    fetch.once("end", function () {
      resolve(emails);
    });
    fetch.once("error", function (err) {
      reject(err);
    });
  });

export const historicalSearch = async (imap, ynab, box, orders) =>
  new Promise((resolve) => {
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
        new Promise(async (resolve) => {
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

      const emailScans = [];

      amazonMsgSeqNums.forEach((seqno) => {
        emailScans.push(
          new Promise(async (resolve) => {
            try {
              const [email] = await fetchOrderEmails(imap.seq, seqno, seqno);
              const order = await scanEmail(email);
              if (order) orders.push(order);
            } catch (e) {
              console.error(e);
            }
            resolve();
          })
        );
      });

      await Promise.all(emailScans);

      console.log("Finished scanning old emails successfully!");

      if (orders.length > 0) {
        orders.sort(function (a, b) {
          return new Date(a.date) - new Date(b.date);
        });

        const sinceDate = orders[0].date;
        await ynab.fetchTransactions(sinceDate);
        const matches = ynab.matchTransactions(orders);
        await ynab.updateTransactions(matches);
      }

      resolve();
    });
  });

export const watchInbox = (imap, ynab, box, orders) => {
  imap.on("mail", async (newEmailCount) => {
    console.log(`${newEmailCount} new email(s), scanning contents...`);
    const endIndex = box.messages.total;
    const startIndex = endIndex - (newEmailCount - 1);
    try {
      const emails = await fetchOrderEmails(imap.seq, startIndex, endIndex);
      for (const email of emails) {
        const order = scanEmail(email);
        if (order) orders.push(order);
      }
      await ynab.matchAndUpdate(orders);
    } catch (e) {
      console.error(e);
    }
  });
};
