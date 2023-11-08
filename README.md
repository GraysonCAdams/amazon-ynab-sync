If you would like to scan past orders, the recommended way is to forward old email confirmation emails (subject example) to yourself and monitor logs to confirm they are being scanned.

Otherwise this scans emails received while this app is running, as there is no database cache for this application to keep track of what's been linked yet. It will wait for a transaction to import to match it, but if the app restarts then it will clear the cache of pending transactions. You may enable auto-transaction creation if you order on the same debit card or credit card every time.

Note: This only checks for order confirmations, so emails such as shipping updates or cancellations will not trigger a sync.

Due to YNAB limitations, pending transactions are not supported and you must  "Enter now" for this tool to find them

# Email settings

Please store your email credentials in environment variables or through a `.env` file. 

Environment variables:
|||

For iCloud emails, make sure to put in your iCloud email address, versus any email alias you may have set up through Apple. You will also need an app-specific password. Otherwise, please follow instructions from your email provider for IMAP.