# Amazon YNAB Sync

Sometimes it is hard to know what your different Amazon charges are. You may have orders for groceries, or supplies, clothes, or a gift.

This script watches your email inbox via IMAP protocol, and watches for new YNAB transactions, and matches Amazon orders to YNAB to the best of its ability.

This **does not use Selenium** or headless browsers, or Amazon sign-in, which is prone to CAPTCHA checks, IP bans, and other issues. It uses the YNAB API, and your mail box.

## Environment variables

Please store your email credentials in environment variables or through a `.env` file. 

```
IMAP_USERNAME=email@domain.com
IMAP_PASSWORD=p@ssw0rd123!
IMAP_INCOMING_HOST=imap.domain.com
IMAP_INCOMING_PORT=993
IMAP_TLS=true
IMAP_INBOX_NAME=INBOX

HISTORICAL_SEARCH_NUM_EMAILS=500

YNAB_TOKEN=yourtokenhere
YNAB_BUDGET_ID=123456-123456-12356-12356
YNAB_ACCEPTABLE_DATE_DIFFERENCE=6
YNAB_ACCEPTABLE_DOLLAR_DIFFERENCE=0.5
```

`HISTORICAL_SEARCH_NUM_EMAILS` is the number of existing emails to scan in your inbox. It is recommended to leave this at around 100-500 depending on how busy your inbox is, so that if the application restarts, it loads recent order confirmations into cache if transactions haven't posted yet.

`YNAB_ACCEPTABLE_DATE_DIFFERENCE` is the number of days a transaction out a transaction can be from the order date to be considered for a match.

For `YNAB_ACCEPTABLE_DOLLAR_DIFFERENCE`, please see "Some Quirks" section.

For iCloud emails, make sure to put in your iCloud email address, versus any email alias you may have set up through Apple. You will also need an app-specific password. Otherwise, please follow instructions from your email provider for IMAP.

## Some Quirks

- Sometimes your Amazon total in your email is a few cents off from the actual transaction amount, or the day of the order confirmation versus YNAB transaction date is a bit off. This script prioritizes direct matches _first_, but then considers transactions that are slightly off (from closest to furthest off) by a configurable threshold.

- Due to YNAB limitations, pending transactions are not supported. You must enter them as scheduled transactions before they can be considered.

- After initial start-up, this matches only when new order emails are received, _that_ is the trigger.

## How do I check old orders?

If you have a bunch that you would like imported, you may use the historical email search feature, which will scan old emails up to a configured amount, and match those _first_ before moving onto watching for new emails. **When turned on, it will load these emails into the cache on every start-up, so be aware of that.**

## How do I stop it from updating a transaction?

It looks for matching transactions with blank memo's. If you don't like the memo it is putting in, you can replace the memo with "N/A" or other filler text to stop automatic updates or exclude a transaction.

## Cache

This is a stateless application, and uses no database. Everything exists in memory. It will cache YNAB transactions on start, and then only properly request new transactions through the API. If you decide to run this as a service, please introduce a restart count limit so that you don't spam YNAB API if there's a fatal bug and the application keeps restarting.