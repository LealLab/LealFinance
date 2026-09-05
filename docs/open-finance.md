# Open Finance

LealFinance can connect a user's banks through Pluggy, an aggregator for
Brazil's Open Finance ecosystem. The integration is read-only: it imports
account snapshots and transactions into the ledger, and displays investment
holdings and loan schedules from the provider without creating editable
investment or loan records.

## Setup and credentials

Open Finance is configured per user from the Open Finance page. Enter the
Pluggy Client ID and Client Secret, then choose the Pluggy environment:

- **Sandbox** is for test connectors and test data.
- **Production** is for real bank connections.

Credentials are encrypted before they are stored with the user's account.
They are never returned by the API, and there are no Open Finance environment
variables or instance-wide fallback credentials. After saving credentials,
choose **Connect a bank** to open the Pluggy Connect widget and authorize a
read-only connection.

## Synchronization

Celery beat runs the Open Finance worker every six hours and syncs linked items
whose data is stale. The page also provides **Sync now** for an individual
connected institution. A sync refreshes the provider account snapshot,
imports new transactions, and stores investment or loan payloads as raw
read-only data. Pluggy transaction IDs make repeated syncs idempotent, so the
same transaction is not imported twice.

## First-sync opening balance

On the first sync of each provider account, LealFinance creates a matching
ledger account and imports the available transaction history. Its opening
balance is then reconciled with the provider's current balance using:

```text
opening balance = synced provider balance - sum(imported signed movements)
```

Income movements are positive and expense movements are negative from the
ledger's perspective. This makes the ledger balance agree with the provider
balance after the imported history is applied. Existing transactions are
deduplicated by their Pluggy ID. Later syncs import only new transactions and
do not reset the opening balance established during the first sync.

## Disconnecting

Disconnecting first removes the item from Pluggy, then removes LealFinance's
provider link and imported provider-account rows.

- **Keep my data** detaches the provider accounts from their ledger accounts;
  the ledger accounts and their existing transactions remain available as
  ordinary ledger data.
- **Remove everything** deletes the linked ledger accounts through the normal
  account cascade, along with their dependent data.

The choice applies to the selected institution only. Credentials remain in
place until they are separately removed from the credentials section.
