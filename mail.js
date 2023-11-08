import IMAP from "node-imap";
import * as cheerio from "cheerio";
import quotedPrintable from "quoted-printable";

export const isAmazonEmail = ({ subject }) =>
  subject.includes('Your Amazon.com order of "') &&
  !subject.includes("has shipped") &&
  !subject.includes("has been canceled");

export const scanEmail = (email) => {
  const { from, subject, body, attributes } = email;

  if (!isAmazonEmail(email)) {
    console.log("Not an Amazon order email (subject or body mismatch)");
    return;
  }

  // Mail forwarding sometimes messes with ID/class attributes,
  // so cleaning up the attributes prefixed with "x_"
  const $ = cheerio.load(body.replace(/"x_/g, '"'));

  try {
    const amount = parseFloat($('table[id$="costBreakdownRight"] td').text().trim().slice(1));

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
      items.push(title);
    };

    const date = new Date(attributes.date.setHours(0, 0, 0, 0));

    console.info(
      `${date} order totaling ${amount}, with ${
        items.length
      } item(s): ${items.join(", ")}`
    )

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

export const readEmail = (imapMsg, readBody = true) =>
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
        reject()
      }
    });
  });

export const fetchOrderEmails = async (seq, startIndex, endIndex) =>
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
