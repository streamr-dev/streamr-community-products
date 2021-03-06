require("dotenv/config")

const StreamrClient = require("streamr-client")
new StreamrClient({
    retryResendAfter: 1000,
    orderMessages: false,
}).resend({
    stream: "szZk2t2JTZylrRwN6CYJNg",
    resend: {
        from: {
            timestamp: 1,
            sequenceNumber: 0,
        }
    }
}, (message) => {
    if (!Array.isArray(message.addresses)) {
        console.error("Bad message: " + JSON.stringify(message))
        return
    }
    message.addresses.forEach(address => {
        console.log(`${message.type} ${address}`)
    })
}).then(sub => {
    sub.on("resent", () => {
        console.error("got RESENT, exiting on")
        setTimeout(() => process.exit(0), 5000)
    })
})
setTimeout(() => process.exit(1), 10 * 60 * 1000)
