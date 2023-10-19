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

  // Enter proof object returned by Sismo here
  const twitterAcountOwnershipProof = JSON.stringify({
    appId: "0x6ddc505a5ebd175f46e780edfb572c96",
    namespace: "main",
    version: "sismo-connect-v1.1",
    proofs: [
      {
        auths: [
          {
            authType: 2,
            userId: "0x1002000000000000000001644137470898962433",
            extraData: "",
            isSelectableByUser: true,
          },
        ],
        proofData:
          "0x2fb9c4eec8b746ca7f2e9a1104a26f3cdcbe6174e77cc128a336080807877e6f1c7800585934ed3929db8c22eaa6ce40608f18019d5203ed8c5f3d8ad6cbf939284a9350d6aa75d97d7aa9d3e3f39f892c1fc5137495f0aa906718c250fdf68016b79680f9050b4c533ba91c8859b32ef6aa60d00ea3583abd9eb549762a98ad1eeab8765ca968ae60328cf7bc17f481a375623cc317b42ba38db04d9954989a116e1aab94da5076c2ebbafc11098b7d363049276c8cec94b94da0e59a70d8921b23c6a3fd5c3159a95ec1dc694ca283a822c11ee48b88261aa54db6b717c9ef1c8461437386cc02ed1f6dd7253afd7c5de5d8bd95441c57e781edc75d633a5f0000000000000000000000001002000000000000000001644137470898962433000000000000000000000000000000000000000000000000000000000000000007f6c5612eb579788478789deccb06cf0eb168e457eea490af754922939ebdb920706798455f90ed993f8dac8075fc1538738a25f0c928da905c0dffd81869fa0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001a0a109874a2dbb8158f4557b72ee5c07e9704113dd1b5460003c4e91de8bdfe1369928909d3d44e3e187b799182b32a8238f9fe5c89962cfd75741706f4d9a200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001",
        extraData: "",
        provingScheme: "hydra-s3.1",
      },
    ],
  })

  const encryptedTwitterAcountOwnershipProofArrayBuffer = await crypto.subtle.encrypt(
    {
      name: "AES-CBC",
      iv,
    },
    importedSymmetricKey,
    new TextEncoder().encode(twitterAcountOwnershipProof)
  )
  const encryptedTwitterAcountOwnershipProofBase64 = toBase64(
    new Uint8Array([...iv, ...new Uint8Array(encryptedTwitterAcountOwnershipProofArrayBuffer)])
  )

  console.log(`\nEncrypted twitter account ownership proof in base64: ${encryptedTwitterAcountOwnershipProofBase64}`)
})()
