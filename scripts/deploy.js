require("dotenv/config")

const {
    Contract,
    getDefaultProvider,
    Wallet,
    utils: { getAddress },
    providers: { JsonRpcProvider }
} = require("ethers")

const deployContract = require("../src/utils/deployContract")
const { throwIfNotContract, throwIfBadAddress } = require("../src/utils/checkArguments")

const TokenContract = require("../build/ERC20Detailed.json")

const {
    ETHEREUM_SERVER,            // explicitly specify server address
    ETHEREUM_NETWORK,           // use ethers.js default servers
    ETHEREUM_PRIVATE_KEY,
    TOKEN_ADDRESS,
    BLOCK_FREEZE_SECONDS,
    STREAMR_WS_URL,
    STREAMR_HTTP_URL,

    GAS_PRICE_GWEI,
    OPERATOR_ADDRESS,
    STREAMR_NODE_ADDRESS,
    ADMIN_FEE,
    QUIET,
} = process.env

const log = QUIET ? () => {} : (...args) => {
    console.log(...args)
}
const error = (e, ...args) => {
    console.error(e.stack, ...args)
    process.exit(1)
}

async function start() {
    // TODO: move process.env parsing logic to a separate file
    const provider =
        ETHEREUM_SERVER ? new JsonRpcProvider(ETHEREUM_SERVER) :
        ETHEREUM_NETWORK ? getDefaultProvider(ETHEREUM_NETWORK) : null
    if (!provider) { throw new Error("Must supply either ETHEREUM_SERVER or ETHEREUM_NETWORK") }

    const network = await provider.getNetwork().catch(e => {
        throw new Error(`Connecting to Ethereum failed, env ETHEREUM_SERVER=${ETHEREUM_SERVER} ETHEREUM_NETWORK=${ETHEREUM_NETWORK}`, e)
    })
    log("Connected to Ethereum network: ", JSON.stringify(network))

    const operatorAddress = throwIfBadAddress(OPERATOR_ADDRESS, "env variable OPERATOR_ADDRESS")
    const tokenAddress = await throwIfNotContract(provider, TOKEN_ADDRESS, "env variable TOKEN_ADDRESS")
    const streamrNodeAddress = getAddress(STREAMR_NODE_ADDRESS) || "0xc0aa4dC0763550161a6B59fa430361b5a26df28C" // node address in production
    const blockFreezeSeconds = BLOCK_FREEZE_SECONDS ? +BLOCK_FREEZE_SECONDS : 3600
    const adminFee = Number.parseFloat(ADMIN_FEE) || 0

    if (!ETHEREUM_PRIVATE_KEY) { throw new Error("Must set ETHEREUM_PRIVATE_KEY environment variable!") }
    const privateKey = ETHEREUM_PRIVATE_KEY.startsWith("0x") ? ETHEREUM_PRIVATE_KEY : "0x" + ETHEREUM_PRIVATE_KEY
    if (privateKey.length !== 66) { throw new Error("Malformed private key, must be 64 hex digits long (optionally prefixed with '0x')") }
    const wallet = new Wallet(privateKey, provider)

    log("Checking token info...")
    const token = new Contract(TOKEN_ADDRESS, TokenContract.abi, provider)
    log("  Token name: ", await token.name())
    log("  Token symbol: ", await token.symbol())
    log("  Token decimals: ", await token.decimals())

    const contract = await deployContract(wallet, operatorAddress, tokenAddress, streamrNodeAddress, blockFreezeSeconds, adminFee, STREAMR_WS_URL, STREAMR_HTTP_URL, GAS_PRICE_GWEI)
    const joinPartStreamId = await contract.joinPartStream()

    log(`Deployed DataunionVault contract at ${contract.address}`)
    log(`Network was ${JSON.stringify(network)}`)
    log(`JoinPartStream ID: ${joinPartStreamId}`)
    log("[DONE]")
}

start().catch(error)
