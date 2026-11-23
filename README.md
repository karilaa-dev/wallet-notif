# Wallet alerts

A self-hosted wallet transfer monitor with a password-protected Cloudflare Kumo dashboard. Each notification destination owns its wallet rules. You can follow the same wallet on several networks, send its activity to multiple destinations, or split alerts by asset. Only public wallet addresses are needed.

## Run locally

Use Node.js 24 or newer. From the project directory:

```sh
npm ci
npm run build
cp .env.example .env
```

Set `ADMIN_PASSWORD` in `.env`, then run `npm start` and open **http://127.0.0.1:3000**. The same process serves the dashboard, polls providers and sends notifications. Keep it running to receive alerts. The first launch starts with an empty destination list.

## Deploy with Dokploy

Create an application from this Git repository, select the Dockerfile build type and route the dashboard to container port 3000. Provide `ADMIN_PASSWORD` in the application's environment and mount a persistent volume at `/app/data`, writable by UID 1000. Use one replica so only one worker polls the wallets. Set `COOKIE_SECURE=true` when the dashboard uses HTTPS.

To move an existing installation, stop the original worker before taking the final SQLite backup. Restore the backup to `/app/data/wallet.sqlite` before starting the replacement worker. The database carries wallet rules, destination and source credentials, polling checkpoints and delivery history. Supply the original admin password separately through Dokploy.

## Set up a destination

1. Sign in, choose **Add destination**, and name it.
2. Choose **ntfy**, **Telegram** or **Webhook**. For ntfy, enter a topic, choose a priority, and optionally set a self-hosted server and access token. Subscribe to the same server and topic in the ntfy app. On a public server, choose a private, unguessable topic or use access controls. For Telegram, enter the BotFather token and chat ID. Start the bot in your private chat or add it to the target group or channel with permission to send.
3. Add a wallet address and choose its networks. Each rule defaults to **Received** and **All** assets. Enable both directions to include sends. Add additional rules for other wallets or address families.
4. Save and use **Send test**. Open **Deliveries** for the latest 100 notifications and their delivery status and **Monitors** for provider status by wallet and network.

For a USDT split, create two destinations with the same wallet and network selection. Set the first rule to include only USDT and the second to exclude USDT. Additional rules on a destination are combined with OR. A broad “all assets” rule on the same destination would also match USDT. Overlapping rules deliver a transfer once per destination and watched address.

## Network coverage

| Mainnet | Activity reported | Data source |
| --- | --- | --- |
| Ethereum, Base, Arbitrum One, OP Mainnet, Polygon PoS | Successful native payments, indexed internal transfers and ERC-20 transfers | Blockscout public, Blockscout PRO or Etherscan V2. Ethereum also supports Routescan. |
| BNB Smart Chain | Native BNB, internal and BEP-20 transfers | Etherscan V2 (key required) |
| Avalanche C-Chain | Native AVAX, internal and ERC-20 transfers | Routescan or Etherscan V2 |
| TON | Completed TonTransfer and JettonTransfer actions involving the account | TonAPI or TON Center v3 |
| TRON | Confirmed TRX transfers, TRX attached to contract calls, indexed internal TRX transfers, TRC-20 transfers | TronGrid or TRONSCAN |
| Bitcoin | Confirmed net BTC movement for a mainnet address | Blockstream Esplora or mempool.space |

The USDT preset matches known contract addresses for each selected chain. It includes the Superchain-listed bridged contracts on Base and OP Mainnet, and USDT0 deployments on Arbitrum, Polygon and OP Mainnet. The editor shows the exact contracts. Select a custom contract to match a single deployment. Bitcoin rules follow individual addresses. A Bitcoin spend reports the decrease at that address, including fees and change sent to a different address. NFTs, approvals, pending transactions, validator rewards and arbitrary smart-contract activity are outside the transfer monitor’s coverage.

Contract references are available from [Tether](https://tether.to/en/supported-protocols/), the [Superchain token list](https://github.com/ethereum-optimism/ethereum-optimism.github.io/blob/master/data/USDT/data.json), and [USDT0](https://docs.usdt0.to/technical-documentation/deployments).

## Transaction sources and token contracts

Open **Sources**, choose a network, then **Configure**. Select the provider and enter its API key if required. For self-hosted indexers choose **Custom** and enter the base URL. EVM custom endpoints use Blockscout v2, TON uses TonAPI v2, TRON uses TronGrid v1 and Bitcoin uses Esplora. Each saved change applies to polling immediately and retains the network’s checkpoint. Keys and custom URLs are write-only in the dashboard. Provider plans and request limits vary by network. [Etherscan chains](https://docs.etherscan.io/supported-chains) · [Routescan chains](https://docs.routescan.io/getting-started/supported-chains)

In a destination rule, select networks, choose **Only** or **All except**, then **Token from catalog**. Search by name or symbol and select a result. The catalog uses CoinGecko coin IDs and shows each network’s contract. The saved rule pins those addresses and continues working during a catalog outage. The server refreshes its catalog at most once per day and can serve its last saved copy if refresh fails. Manual entry remains available for unlisted tokens. The BNB USDT preset covers Binance-bridged USDT and Avalanche uses native-issued USDT. [CoinGecko coin and contract directory](https://docs.coingecko.com/reference/coins-list)

Existing installations import former provider environment values into SQLite when initializing each network. Subsequent changes belong in **Sources**. After verifying the imported configuration you can remove the old provider entries from your environment file.

## Server configuration

| Environment variable | Default or use |
| --- | --- |
| `ADMIN_PASSWORD` | Required. Restart after changing it. Sessions expire after 12 hours or a process restart. |
| `HOST`, `PORT` | `127.0.0.1`, `3000` |
| `DB_PATH` | `data/wallet.sqlite`. Keep the database on persistent storage. |
| `POLL_SECONDS` | `60` per feed. Failed feeds back off, up to 15 minutes. |
| `COOKIE_SECURE` | Set to `true` when serving behind an HTTPS reverse proxy. Preserve the original Host header. |

The database contains destination and provider credentials. Run a single app instance under a dedicated OS user, restrict access to the data directory and its backups, and use TLS for remote access. The admin API hides saved webhook URLs and access tokens. The configured indexers receive the public addresses being watched.

## Delivery and recovery

New rules watch transfers with block timestamps at or after the rule was saved. When a rule changes, transfers continuously covered by the destination retain their original start time. Newly included networks, directions and assets start at the edit time. Polling starts from the last persisted watermark after restart and rechecks overlapping history for indexing delays. Deliveries and watermark updates commit together. Providers determine which transfers are indexed and how quickly they appear. Deep reorganizations and indexing delays beyond the overlap can require manual reconciliation. Alerts do not establish irreversible settlement.

Webhooks receive a JSON POST with a stable `Idempotency-Key` header. A transfer payload includes the destination, delivery ID, network, wallet, direction, transaction ID, asset contract or `native`, symbol, decimal precision, raw amount, formatted amount and block timestamp. Transfers also include a readable `message` and an explorer link in `transactionUrl`. Incoming TON and jetton transfers with a plaintext comment include it in the message and in the webhook’s `comment` field. Native TRX transfers also include a text memo when the source provides one. Telegram and ntfy show the link as a **View transaction** button. Raw amounts are strings so large values retain precision. Test messages have `type: "test"`.

The worker delivers to up to four destinations concurrently, with one queued request in flight per destination. It retries failed transfers up to 12 total attempts and caps retry delays at one hour. Delivery is at least once. If a receiver accepts a request but the response is lost, it can receive a duplicate. A webhook can deduplicate by delivery ID. Queued alerts use the destination settings in effect when the worker sends them. Test messages report their first result immediately. Deleting a destination removes its rules, queued alerts and delivery history.

## Development

```sh
npm test
npm --prefix client run dev
```

Run the backend with `npm start` in a second terminal. Vite proxies `/api` to port 3000. Override `API_TARGET` for another backend address. The tests exercise the API, local provider and webhook HTTP flow, chain decoding, rule matching, SQLite restart recovery and delivery retries.

