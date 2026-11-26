export const auth = {
  email: {
    code: {
      subject: 'Your {{appName}} sign-in code',
      body: 'Your sign-in code is {{code}}. It expires in {{minutes}} minutes. If you did not ask for this code, you can ignore this email.',
    },
  },
} as const;
