const fs = require("fs")
const { Location, ReturnType, CodeLanguage } = require("@chainlink/functions-toolkit")

// Configure the request by setting the fields below
const requestConfig = {
  // String containing the source code to be executed
  source: fs.readFileSync("./redemption.js").toString(),
  //source: fs.readFileSync("./API-request-example.js").toString(),
  // Location of source code (only Inline is currently supported)
  codeLocation: Location.Inline,
  // Optional. Secrets can be accessed within the source code with `secrets.varName` (ie: secrets.apiKey). The secrets object can only contain string values.
  secrets: {
    privateDecryptionKeyBase64:
      "MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDBjcnlHM35VmRGKpJqL+3Y98HrWl3JjVLuuOSTQ31scdNpKFiDcRtIsECP/bpBaMDs4zOQGEqwuGRGPyfbBgQadY6GKLH0ZLYjs4XV8iuSA5NEtdCYhlXu5P9fw9UfDw2g32qW7CoirNdQijhMeaXU7R4OzsR6E1p5i7xVxEqDBmbgeqP7q+nkddmZsnpC+1rgbqRdA03mXw0yh749FY5OBKDHxY/ZcHusQPNlgQysxyVcPzgu1s0+R00t5SV7LyqW7RJ2/xqD3xoaDN76MIYSH/LfxTbhgOzjVLA8p0TewH80J0jzn1qnF19I63KGErn+ZN6qWByRn4XMROfwnZWJAgMBAAECggEAKM82dGJAY4P9nHW5bT4xzf9fGbpx798mT0MYnpwqQ8U0KAXjs8MTV54h3rpGnSfzFX9KDeWxSdV2/wCt7JY2I0YKCOtnqfnaFWjynQt0eFLcqC4VjzMzxyztU0m9E9FetD6nAK9Gqwz6UPbzq9wyRNTB86lQ79RIzTvTN9otQ7alxpCavH1s7cMWeBAsQjjyIWxGdzKID1AJXt/WqxpWIbOH4WjkgSS9oci32lJ0NxSj1oX9uIeIg40KbF0W7C+WaXgQfvQiIC4+6CisJodp1cPlRJUNCT6TFQvdSh+Oudmb92eWJ31sFtMmzuz72Y+ldnvHsn66dGOd98V7AQPKiQKBgQDtXcatqOYeuwFcCDfQFqWc/uuCt1puLFxvk4aehNL15LrREUHevZ962GQFO+FgqtaWpd9HIQZb6pEuVD49Cd0vcL6meb430iV3EvpjJV+KuTg0yVxn0MjutC1CTkzERPI3+/YXTqPIRGTfJUP9cqLme1ByB4oFVXh/JvOXsY8EhwKBgQDQv4mDJFeSQ23REI85J2JxxFgKbLDHrpiYFVRkBz0gLFeaVsq5aGtQqta2TeSeKIh+y4kHbKWggzjFMVQlADmD0YsOJuO2x81KuPjWVG9zhpjDYJV3BYkwUveDdYtvDHEhS53EikZ2xsE3qXTwht3a4hkW9svskO28N6aO7lcpbwKBgQDgGXMkLZvlU4T7EL8w9NCzInHTXaxA7BzxMoUcUCakBKjkDbj0xG43GumDj38/NsuWO1BL5UANs64R4XNJSXDMA1Pb9IDETuEURJSk2noTjL8mBx343cN2qiE4wpfzjWxpsrYqVxKGVxwtGQ/Rz1NA6xeOMNP8KS+0TGAazYZLLQKBgHQY4sD2GGI3cD8jJ5TQ67Z8Tb7WfmdAGowS6NGNGRjosHwdIziE85J0wV+46JpxzqA+UOK5MVCZSpyZd8PwYQyIIP9o76K7ctjJEVQat7WXuSSIdfgxMwCWVCRf3oGPeOfcp00k3lW26sUrUOdpCsBumSelcPsMC7xvcwnxUravAoGBAOjnLvnCXXSd6uocMzk0ynD7DqjojqrisnMssH/W6Jjw+WdnyuNED6m9/m/qXTUfBetWgRNg+xFsxdFD9q4hPdCbvxTvljNcsgNCfka3K+nHXvNEz0zSzlzMUz3xdf/u4qvpwtJm4Jh0fUx/dz64IV/RqeNISFGxeX4z0gNKY6Gz",
    openAiApiKey: process.env["OPENAI_API_KEY"],
    twitterApiKey: process.env["TWITTER_API_KEY"],
  },
  // Optional if secrets are expected in the sourceLocation of secrets (only Remote or DONHosted is supported)
  secretsLocation: Location.DONHosted,
  // Args (string only array) can be accessed within the source code with `args[index]` (ie: args[0]).
  args: [
    "UzTYUtK4LnWjefQ6pKzcWrxCUaipxD72q0hWy8iNw+ct0V8M+j8Wi3j0p4EtxFz4X2WhYIAIntDtzybMMdjmN+tYULraw8kqZNJEVcGVENHqOjauHEvbPIEgpFrvcqE6jGiTRu4XeqVkhR+StpDnKf8x2HkMftVS8NwrxT839PnyWZiA5Upwx5XobWPe8qw6JtWDIPlFMiqPMTqdngadoHKYSBE0lgLS0qQR9Xk/Jrsn2nvwQm8SrhrQXWWiIjyCBS2MxgAPTwcMLYjVcWk/0sluuF3210i3+XquS79zlrAOM64m42cqYuF1KozKdXiphyo60wmGVrk6TUgEFuMfdQ==",
    "J9ss+gIlOanzE+olD5ci97I+lCF0sC8qodRn+m0iKzt9/R5EcbMX3rVAGuFPZPskD5Ipfx69KsiIeUEJocvCcqiP4K93ZWc99uWYC3NCCF2XZCLbiILEwwkGCJqLAHkCKMNHRNqbblNBYOExZ0ulGTtNDjxR8nLb9VCAXcG7C48/HqiSR9mJyXXIb/bB6AQWsCajPz6p0l2AK3DDGZjnKBuQRk0MAQyBZgBbIj1N2k9mPnPc7oIbubFoH9470pF7SStRBfqkY25z1XB5/cQR+HCiDfLszjENMA81k/8ZmPBoqGJvngg2SLaem5VY8QmS",
    "L/bo46WhuTqITpToQXJUv8+XDj98B43HcEXNHU2UqjShKbAcO2esM/DGyQ6xN80g",
  ],
  // Code language (only JavaScript is currently supported)
  codeLanguage: CodeLanguage.JavaScript,
  // Expected type of the returned value
  expectedReturnType: ReturnType.uint256,
}

module.exports = requestConfig
