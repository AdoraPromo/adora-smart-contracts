import * as LitJsSdk from "@lit-protocol/lit-node-client"

const toBase64 = (arr: Uint8Array) => btoa(String.fromCodePoint(...arr))

const fromBase64 = (str: string) =>
  new Uint8Array(
    atob(str)
      .split("")
      .map((c) => c.charCodeAt(0))
  )

const base64UrlToBase64 = (base64Url: string) => {
  let base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/")
  const paddingLength = 4 - (base64.length % 4)
  if (paddingLength !== 4) {
    for (let i = 0; i < paddingLength; i++) {
      base64 += "="
    }
  }
  return base64
}

;(async () => {
  const offerTerms = JSON.stringify({
    twitterUserId: "1644137470898962433", // @KuphDev
    paymentPerLike: 1,
    sponsorshipCriteria:
      "The tweet must have a positive sentiment, contain no profanity or controversial statements, and promote the EthOnline hackathon",
  })
  const tweetId = "1713685371819557135" // https://twitter.com/KuphDev/status/1713685371819557135

  const { symmetricKey, encryptedString } = await LitJsSdk.encryptString(offerTerms)

  const symmetricKeyBase64 = toBase64(symmetricKey as Uint8Array)
  const encryptedOfferTermsBase64 = base64UrlToBase64(await LitJsSdk.blobToBase64String(encryptedString))
  console.log(
    `\nSymmetric key in base64: ${symmetricKeyBase64}\n\nEncrypted offer terms in base64: ${encryptedOfferTermsBase64}`
  )

  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"]
  )

  const exportedPublicKey = await crypto.subtle.exportKey("spki", keyPair.publicKey)
  const exportedPublicKeyBase64 = toBase64(new Uint8Array(exportedPublicKey))
  const exportedPrivateKey = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey)
  const exportedPrivateKeyBase64 = toBase64(new Uint8Array(exportedPrivateKey))
  console.log(
    `\nPublic key in base64: ${exportedPublicKeyBase64}\n\nPrivate key in base64: ${exportedPrivateKeyBase64}`
  )

  const encryptedSymmetricKey = await crypto.subtle.encrypt(
    {
      name: "RSA-OAEP",
    },
    keyPair.publicKey,
    fromBase64(symmetricKeyBase64)
  )
  const encryptedSymmetricKeyBase64 = toBase64(new Uint8Array(encryptedSymmetricKey))
  console.log(`\nEncrypted symmetric key in base64: ${encryptedSymmetricKeyBase64}`)

  // Sanity check that we can decrypt the symmetric key
  const importedKey = await crypto.subtle.importKey(
    "pkcs8",
    fromBase64(exportedPrivateKeyBase64),
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    true,
    ["decrypt"]
  )
  const decryptedSymmetricKey = await crypto.subtle.decrypt(
    {
      name: "RSA-OAEP",
    },
    importedKey,
    fromBase64(encryptedSymmetricKeyBase64)
  )
  if (toBase64(new Uint8Array(decryptedSymmetricKey)) !== symmetricKeyBase64) {
    throw new Error("Decrypted symmetric key does not match original symmetric key")
  }

  const importedSymmetricKey = await crypto.subtle.importKey(
    "raw",
    decryptedSymmetricKey,
    {
      name: "AES-CBC",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"]
  )
  const encryptedOfferTermsUint8Array = fromBase64(encryptedOfferTermsBase64)
  const recoveredIv = encryptedOfferTermsUint8Array.slice(0, 16).buffer
  const encryptedZipArrayBuffer = encryptedOfferTermsUint8Array.slice(16).buffer

  const offerTermsArrayBuffer = await crypto.subtle.decrypt(
    {
      name: "AES-CBC",
      iv: recoveredIv,
    },
    importedSymmetricKey,
    encryptedZipArrayBuffer
  )
  const offerTermsString = new TextDecoder().decode(offerTermsArrayBuffer)
  console.log(`\nDecrypted offer terms: ${offerTermsString}`)

  const iv = crypto.getRandomValues(new Uint8Array(16))
  const encryptedTweetIdArrayBufferWithoutIv = await crypto.subtle.encrypt(
    {
      name: "AES-CBC",
      iv,
    },
    importedSymmetricKey,
    new TextEncoder().encode(tweetId)
  )
  const encryptedTweetIdArrayBuffer = new Uint8Array([...iv, ...new Uint8Array(encryptedTweetIdArrayBufferWithoutIv)])
    .buffer
  const encryptedTweetIDBase64 = toBase64(new Uint8Array(encryptedTweetIdArrayBuffer))
  console.log(`\nEncrypted tweet ID in base64: ${encryptedTweetIDBase64}`)

  const decryptedTweetIDArrayBuffer = await crypto.subtle.decrypt(
    {
      name: "AES-CBC",
      iv: fromBase64(encryptedTweetIDBase64).slice(0, 16).buffer,
    },
    importedSymmetricKey,
    fromBase64(encryptedTweetIDBase64).slice(16).buffer
  )
  const decryptedTweetID = new TextDecoder().decode(decryptedTweetIDArrayBuffer)
  console.log(`\nDecrypted tweet ID: ${decryptedTweetID}`)
  if (decryptedTweetID !== tweetId) {
    throw new Error("Decrypted tweet ID does not match original tweet ID")
  }
})()
