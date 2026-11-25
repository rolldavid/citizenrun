export const errors = {
  // Not an error code: what a failure with no code of its own, or a code with no key, reads.
  generic: 'Something went wrong. Try again.',
  invalid_request: "Something in this request isn't right. Check it and try again.",
  invalid_cursor: "This list couldn't be loaded. Refresh it and try again.",
  client_header_required:
    "This version of the app couldn't be checked. Update the app or reload the page.",
  not_found: "This isn't here. It may have been removed.",
  payload_too_large: "That's too large to send. Make it smaller and try again.",
  upgrade_required: 'This version of the app is out of date. Update it to keep going.',
  rate_limited: 'Too many tries in a short time. Wait a moment and try again.',
  internal: 'Something went wrong on our side. Try again.',
  unavailable: "This isn't available right now. Try again in a few minutes.",
} as const;
