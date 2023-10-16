const [encryptedSymmetricKeyBase64, encryptedOfferTermsBase64, encryptedTweetIdBase64] = args

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
  throw Error(`Failed to import private decryption key: ${e.message}`)
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
  throw Error(`Failed to decrypt symmetric key: ${e.message}`)
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
  throw Error(`Failed to import symmetric key: ${e.message}`)
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

let offerTerms
try {
  offerTerms = JSON.parse(await symDecrypt(encryptedOfferTermsBase64, symmetricKey))
} catch (e) {
  throw Error(`Failed to decrypt offer terms: ${e.message}`)
}

let tweetId
try {
  tweetId = await symDecrypt(encryptedTweetIdBase64, symmetricKey)
} catch (e) {
  throw Error(`Failed to decrypt tweet ID: ${e.message}`)
}

const twitterApiResponse = await Functions.makeHttpRequest({
  url: `https://api.twitter.com/2/tweets/${tweetId}?expansions=author_id&tweet.fields=public_metrics`,
  headers: {
    Authorization: `Bearer ${secrets.twitterApiKey}`,
  },
})

if (twitterApiResponse.status !== 200) {
  throw Error(`Failed to fetch tweet. Status code ${twitterApiResponse.status}`)
}

const tweetData = twitterApiResponse.data?.data
if (!tweetData) {
  throw Error(`Failed to fetch tweet`)
}

if (tweetData.author_id !== offerTerms.twitterUserId) {
  throw Error(`Tweet author ID does not match the user specified in the offer terms`)
}

const tweetLikes = tweetData.public_metrics?.like_count
if (tweetLikes === undefined) {
  throw Error("Failed to fetch tweet likes")
}

const tweetText = tweetData.text
if (!tweetText) {
  throw Error(`Failed to fetch tweet text`)
}

const prompt = `The tweet is: "${tweetText}". The criteria are: "${offerTerms.sponsorshipCriteria}". Please provide a single word response of "yes" or "no" indicating if the tweet meets the criteria.`

const chatGptResponse = await Functions.makeHttpRequest({
  url: "https://api.openai.com/v1/chat/completions",
  method: "POST",
  headers: {
    Authorization: `Bearer ${secrets.openAiApiKey}`,
    "Content-Type": "application/json",
  },
  data: {
    model: "gpt-4",
    messages: [
      { role: "system", content: "Your job is to analyze a tweet to verify if it meets certain criteria." },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
  },
})
console.log(chatGptResponse)

if (chatGptResponse.status !== 200) {
  throw Error(`Failed to analyze tweet. Status code ${chatGptApiResponse.status}`)
}

const chatGptVerdict = chatGptResponse.data?.choices?.[0]?.message?.content?.toLowerCase()
if (chatGptVerdict === undefined) {
  throw Error("Unexpected AI response format")
}

if (chatGptVerdict.includes("yes")) {
  return Functions.encodeUint256(BigInt(tweetLikes) * BigInt(offerTerms.paymentPerLike))
} else if (chatGptVerdict.includes("no")) {
  throw Error("Tweet does not meet criteria")
} else {
  throw Error("AI was unable to determine if the tweet meets criteria")
}
