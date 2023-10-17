const [encryptedSymmetricKeyBase64, encryptedDealTermsBase64, encryptedAccountOwnershipProofBase64] = args

const fromBase64 = (str) =>
  new Uint8Array(
    atob(str)
      .split("")
      .map((c) => c.charCodeAt(0))
  )

let privateDecryptionKey
try {
  privateDecryptionKey = await crypto.subtle.importKey(
    "pkcs8",
    fromBase64(secrets.privateDecryptionKeyBase64),
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    false,
    ["decrypt"]
  )
} catch (e) {
  throw Error(`Failed to import private decryption key`)
}

let symmetricKeyArrayBuffer
try {
  symmetricKeyArrayBuffer = await crypto.subtle.decrypt(
    {
      name: "RSA-OAEP",
    },
    privateDecryptionKey,
    fromBase64(encryptedSymmetricKeyBase64)
  )
} catch (e) {
  throw Error(`Failed to decrypt symmetric key`)
}

let symmetricKey
try {
  symmetricKey = await crypto.subtle.importKey(
    "raw",
    symmetricKeyArrayBuffer,
    {
      name: "AES-CBC",
      length: 256,
    },
    false,
    ["decrypt"]
  )
} catch (e) {
  throw Error(`Failed to import symmetric key`)
}

const symDecrypt = async (encryptedBase64, key) => {
  const encrypted = fromBase64(encryptedBase64)
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-CBC",
      iv: encrypted.slice(0, 16).buffer,
    },
    key,
    encrypted.slice(16).buffer
  )
  return new TextDecoder().decode(decrypted)
}

let dealTerms
try {
  dealTerms = JSON.parse(await symDecrypt(encryptedDealTermsBase64, symmetricKey))
} catch (e) {
  throw Error(`Failed to decrypt deal terms`)
}

let accountOwnershipProofString
try {
  accountOwnershipProofString = await symDecrypt(encryptedAccountOwnershipProofBase64, symmetricKey)
} catch (e) {
  throw Error(`Failed to decrypt account ownership proof`)
}

let accountOwnershipProofObj
try {
  accountOwnershipProofObj = JSON.parse(accountOwnershipProofString)
} catch (e) {
  throw Error(`Failed to parse account ownership proof`)
}

const proofVerificationResponse = await Functions.makeHttpRequest({
  url: `https://sismo-connect-btn.vercel.app/api/verify`,
  method: "POST",
  data: accountOwnershipProofObj,
})

if (proofVerificationResponse.status !== 200) {
  throw Error(`Failed to validate proof. Status code ${proofVerificationResponse.status}`)
}

const twitterIdFromProof = proofVerificationResponse.data?.twitterId
if (!twitterIdFromProof) {
  throw Error(`Verification returned unexpected format`)
}

if (twitterIdFromProof !== dealTerms.twitterUserId) {
  throw Error(`Twitter user ID does not match the user specified in the deal terms`)
}

return Functions.encodeUint256(1)
