import { createHash } from 'node:crypto';

/** The instant every fixed seed literal below was made at with `seedId` (TC-08). */
export const SEED_FIXED_AT = new Date('2026-01-01T00:00:00.000Z');

/**
 * The fixed ids of the 50 seed users: `seedId('user', NN, SEED_FIXED_AT)`, the admin as user 50
 * (TC-08). Written as literals so a re-run upserts the same rows.
 */
export const SEED_USER_IDS = {
  admin: '019b76da-a800-7772-a902-26f871c56e44',
  '01': '019b76da-a800-7abc-8e91-ee2b462e1571',
  '02': '019b76da-a800-7019-9585-b3b224293726',
  '03': '019b76da-a800-74bb-903e-92d0a38cbbb2',
  '04': '019b76da-a800-796f-82ff-dd294597f849',
  '05': '019b76da-a800-7856-b140-0c4382e472c0',
  '06': '019b76da-a800-7dbf-bf3a-7a4f2a182d8b',
  '07': '019b76da-a800-720b-b71e-b9c20b4879d9',
  '08': '019b76da-a800-7a4e-84c9-2485ba27362a',
  '09': '019b76da-a800-7113-9e84-74b99b17b4e1',
  '10': '019b76da-a800-7d3b-9afb-d053718fbac7',
  '11': '019b76da-a800-7a78-a24b-664ec3a9e168',
  '12': '019b76da-a800-7613-8d96-815b8306889f',
  '13': '019b76da-a800-7676-9f61-93059288722e',
  '14': '019b76da-a800-7623-a418-84d4841ee91a',
  '15': '019b76da-a800-7944-a45c-7d9a6f2b8c28',
  '16': '019b76da-a800-7800-9785-afabe0d6fbd3',
  '17': '019b76da-a800-7e0b-b490-3415cc6a2a0c',
  '18': '019b76da-a800-7f25-9ba5-27d3902e8d3a',
  '19': '019b76da-a800-7ce3-964b-736544c4d08b',
  '20': '019b76da-a800-7b8e-b3a6-d35455016854',
  '21': '019b76da-a800-708e-ac1a-d1e016ac3366',
  '22': '019b76da-a800-77b5-82bc-2ba1e99802d5',
  '23': '019b76da-a800-70b9-97b9-88fc9920dff6',
  '24': '019b76da-a800-7810-83ca-e1e7810164fa',
  '25': '019b76da-a800-7a85-bf39-8ed29075c676',
  '26': '019b76da-a800-7a67-892d-307cda006641',
  '27': '019b76da-a800-7e44-8f9a-2df2d1c9833b',
  '28': '019b76da-a800-7697-b0a2-cdda407ff5fe',
  '29': '019b76da-a800-749e-9771-e6adb6062374',
  '30': '019b76da-a800-7c24-a0fd-de894450d036',
  '31': '019b76da-a800-7b2f-8308-2f59b84724d8',
  '32': '019b76da-a800-7fc8-80db-d34effe7b8eb',
  '33': '019b76da-a800-72d0-8ab6-82bbf1b5db7c',
  '34': '019b76da-a800-7ed6-acd9-b67cc7885813',
  '35': '019b76da-a800-71f7-89be-505aa9c5f734',
  '36': '019b76da-a800-7b9d-a798-3778c91cc93a',
  '37': '019b76da-a800-7442-bbef-fdbce40db5fd',
  '38': '019b76da-a800-7afa-af7a-02104b94d929',
  '39': '019b76da-a800-76c3-bdeb-7d3ca9e450e9',
  '40': '019b76da-a800-781d-bf69-28fb257aba9f',
  '41': '019b76da-a800-7b04-a7dd-3df745952e46',
  '42': '019b76da-a800-7ea3-bf50-ef8795f58b85',
  '43': '019b76da-a800-715d-84be-894a17f8678a',
  '44': '019b76da-a800-7687-b8c6-54966589ff93',
  '45': '019b76da-a800-7e97-9ccd-fa6df66de561',
  '46': '019b76da-a800-7783-8fec-0f216255d24b',
  '47': '019b76da-a800-771c-b53d-ecf804135d59',
  '48': '019b76da-a800-7bfe-971d-ee5177de9407',
  '49': '019b76da-a800-75de-be5d-2ee2d2bbdd20',
} as const;

/** A seed user's key: `admin` or `01` to `49`. */
export type SeedUserKey = keyof typeof SEED_USER_IDS;

/** The fixed ids of each seed user's four consents: `seedId('consent-<kind>', NN, SEED_FIXED_AT)`. */
export const SEED_CONSENT_IDS = {
  admin: {
    terms: '019b76da-a800-79a0-99a3-be5e065ebbb9',
    content_policy: '019b76da-a800-7ffc-bc54-db474adb1b21',
    privacy_policy: '019b76da-a800-7388-8599-b90cbf9fdc2b',
    ai_screening: '019b76da-a800-7629-886c-1519d5a41630',
  },
  '01': {
    terms: '019b76da-a800-76fc-a36e-2a25674d6b17',
    content_policy: '019b76da-a800-7c81-92ea-aeef8324ee39',
    privacy_policy: '019b76da-a800-7c1f-b727-a5a5531bea19',
    ai_screening: '019b76da-a800-7879-9335-bfff95a7ca1a',
  },
  '02': {
    terms: '019b76da-a800-7c03-9938-3696965e0b79',
    content_policy: '019b76da-a800-721e-bb66-ef5da6b4d246',
    privacy_policy: '019b76da-a800-7a9f-a441-b4fa0505aeb8',
    ai_screening: '019b76da-a800-759b-9c99-fa8bd9c1c3ff',
  },
  '03': {
    terms: '019b76da-a800-7c26-9120-cb02948e0fe4',
    content_policy: '019b76da-a800-79d2-9d5f-19e3d56b323c',
    privacy_policy: '019b76da-a800-7c4e-af77-30ad80368ae9',
    ai_screening: '019b76da-a800-7d22-9c0f-4f3918dae1b8',
  },
  '04': {
    terms: '019b76da-a800-7486-939d-e59e2214d2ba',
    content_policy: '019b76da-a800-701e-8d1d-aeda1e96b004',
    privacy_policy: '019b76da-a800-768c-9018-58d18073fece',
    ai_screening: '019b76da-a800-7c42-9ebf-d881b29371cf',
  },
  '05': {
    terms: '019b76da-a800-7e63-b3a3-1ccc078cdee5',
    content_policy: '019b76da-a800-72bb-a699-c3c55141beeb',
    privacy_policy: '019b76da-a800-774a-ada2-cef6b68ca838',
    ai_screening: '019b76da-a800-74f6-80c6-b1d6156b520a',
  },
  '06': {
    terms: '019b76da-a800-7634-8c33-afc50191fbd5',
    content_policy: '019b76da-a800-788f-955d-9b671c446e04',
    privacy_policy: '019b76da-a800-7132-93de-8f93c3b4a092',
    ai_screening: '019b76da-a800-7891-bdc6-9bc308e213bf',
  },
  '07': {
    terms: '019b76da-a800-740f-a159-aa46c9f60c11',
    content_policy: '019b76da-a800-7f55-bd5c-532cddd86eea',
    privacy_policy: '019b76da-a800-7981-83e1-376f9d361294',
    ai_screening: '019b76da-a800-716f-9bb3-b21bc9acf712',
  },
  '08': {
    terms: '019b76da-a800-7dee-9209-a86187dd798b',
    content_policy: '019b76da-a800-755d-aa4c-7abd7e5b3313',
    privacy_policy: '019b76da-a800-75f6-a44c-acdd51d1f4d1',
    ai_screening: '019b76da-a800-7cc3-b6cc-690aa0b56f84',
  },
  '09': {
    terms: '019b76da-a800-70ae-8940-27c82b4c716c',
    content_policy: '019b76da-a800-7039-8dfd-8467d7d2902e',
    privacy_policy: '019b76da-a800-71b3-be1f-6e4fa501ac6a',
    ai_screening: '019b76da-a800-76f0-bee3-5201375b6fa2',
  },
  '10': {
    terms: '019b76da-a800-7c20-b9fb-975ac6aa99ef',
    content_policy: '019b76da-a800-71ad-992c-d22a3346e946',
    privacy_policy: '019b76da-a800-7b2e-85a7-87eacec3d17d',
    ai_screening: '019b76da-a800-7488-8f9c-94a0b7597efd',
  },
  '11': {
    terms: '019b76da-a800-7288-809d-42baf836a973',
    content_policy: '019b76da-a800-7e7c-9e47-3a8ce82dacb2',
    privacy_policy: '019b76da-a800-7017-93b7-4a3ac2c43985',
    ai_screening: '019b76da-a800-7f05-97c1-ae2c1de537be',
  },
  '12': {
    terms: '019b76da-a800-7182-8afb-ff16b1b61e2a',
    content_policy: '019b76da-a800-7622-bbcc-33f10827f930',
    privacy_policy: '019b76da-a800-70d0-8189-65dd88ad0064',
    ai_screening: '019b76da-a800-7cc3-b5e1-683ea84fe707',
  },
  '13': {
    terms: '019b76da-a800-750c-8e77-61610b41cf0f',
    content_policy: '019b76da-a800-7a94-8f42-34a7e4df627a',
    privacy_policy: '019b76da-a800-7530-88f2-7d97f5b3781d',
    ai_screening: '019b76da-a800-711f-9656-48a39cc25edd',
  },
  '14': {
    terms: '019b76da-a800-7257-95aa-fc32bb8dcd93',
    content_policy: '019b76da-a800-7910-89b0-571d632e3da9',
    privacy_policy: '019b76da-a800-71d5-b8ea-51cf33bb5089',
    ai_screening: '019b76da-a800-7099-889b-ef58605e075e',
  },
  '15': {
    terms: '019b76da-a800-7bbb-90c6-ddc63fd5b0ce',
    content_policy: '019b76da-a800-736c-813d-f338802586f7',
    privacy_policy: '019b76da-a800-7cf7-9439-209459bc5b1a',
    ai_screening: '019b76da-a800-7af1-b768-ab277e435240',
  },
  '16': {
    terms: '019b76da-a800-7187-98c2-067cd5c4d106',
    content_policy: '019b76da-a800-73ff-9dbd-61b810121e07',
    privacy_policy: '019b76da-a800-7fdf-8ca0-93677b2893ad',
    ai_screening: '019b76da-a800-7c66-9023-28b809985774',
  },
  '17': {
    terms: '019b76da-a800-7b7e-9158-19a63600352a',
    content_policy: '019b76da-a800-75be-9ad4-f0851bb6e7b2',
    privacy_policy: '019b76da-a800-7e12-97cf-7b8e7d36f2ea',
    ai_screening: '019b76da-a800-751c-911a-8b33e5750c1e',
  },
  '18': {
    terms: '019b76da-a800-7b18-850d-5d05e9431f74',
    content_policy: '019b76da-a800-7d58-ab43-e5f02ad2b071',
    privacy_policy: '019b76da-a800-774f-97c3-0a62cb1a15ac',
    ai_screening: '019b76da-a800-7c1f-af9b-1d42333cbd2f',
  },
  '19': {
    terms: '019b76da-a800-71c1-a8e9-9acba0e8c1fd',
    content_policy: '019b76da-a800-7e06-ab1a-0df3a5784a25',
    privacy_policy: '019b76da-a800-75e9-a538-9a374b34ff71',
    ai_screening: '019b76da-a800-770b-8a75-cbfa0a0b48aa',
  },
  '20': {
    terms: '019b76da-a800-7a21-89a5-c20d6ef4da4a',
    content_policy: '019b76da-a800-7da9-bb65-88f689a10b50',
    privacy_policy: '019b76da-a800-7a69-90d7-17cc0596af0b',
    ai_screening: '019b76da-a800-71a6-a284-57c2cdb34e10',
  },
  '21': {
    terms: '019b76da-a800-7f38-b5fc-56c9c944b374',
    content_policy: '019b76da-a800-7240-ba33-234402c24011',
    privacy_policy: '019b76da-a800-7c0a-bdc8-ba38869e5282',
    ai_screening: '019b76da-a800-7c8a-9497-6b05162429cc',
  },
  '22': {
    terms: '019b76da-a800-7ce7-a054-1474dbb074de',
    content_policy: '019b76da-a800-7ce3-97b7-fe81dc4ab86f',
    privacy_policy: '019b76da-a800-756e-8aab-a0e3012925f7',
    ai_screening: '019b76da-a800-70ec-81e7-9832e465f106',
  },
  '23': {
    terms: '019b76da-a800-7d3b-83d7-77468f2a3bce',
    content_policy: '019b76da-a800-794d-8003-e81ce750177c',
    privacy_policy: '019b76da-a800-71ec-99bc-25abfaa0d391',
    ai_screening: '019b76da-a800-7820-9f9a-a28d4e116ab9',
  },
  '24': {
    terms: '019b76da-a800-73b1-9788-182072af2581',
    content_policy: '019b76da-a800-7a78-8786-53fd0d237a6a',
    privacy_policy: '019b76da-a800-7d42-bdb5-f463f55ec82c',
    ai_screening: '019b76da-a800-795f-8f44-c34bf097a75b',
  },
  '25': {
    terms: '019b76da-a800-7eb6-bc0e-d803283fdff1',
    content_policy: '019b76da-a800-7a14-8d57-d871a51bba2a',
    privacy_policy: '019b76da-a800-76f5-8d40-a10b66b124a0',
    ai_screening: '019b76da-a800-717e-8f2e-c4407690dc21',
  },
  '26': {
    terms: '019b76da-a800-7f08-b380-6f8c72d1f317',
    content_policy: '019b76da-a800-776b-9638-14cc800172dc',
    privacy_policy: '019b76da-a800-7a66-b96e-4d66d0ae7b11',
    ai_screening: '019b76da-a800-76f7-b495-277b904d5c8d',
  },
  '27': {
    terms: '019b76da-a800-727a-91ef-44ceedc5cdd4',
    content_policy: '019b76da-a800-77a1-82dc-0d5bc6e05bdf',
    privacy_policy: '019b76da-a800-7ccc-8f18-3c9d76891652',
    ai_screening: '019b76da-a800-7f2e-8233-51e5c7132066',
  },
  '28': {
    terms: '019b76da-a800-798c-a9ac-5a5b358eec62',
    content_policy: '019b76da-a800-7dc9-ad07-d2dffd6acd7a',
    privacy_policy: '019b76da-a800-7041-8b37-0dc322e6019a',
    ai_screening: '019b76da-a800-7f8b-ac99-7133b3a72746',
  },
  '29': {
    terms: '019b76da-a800-7477-9c72-9d766140297e',
    content_policy: '019b76da-a800-7270-8a0d-a9fc8d19d6cf',
    privacy_policy: '019b76da-a800-70b6-bdd3-fd37dd7c32d5',
    ai_screening: '019b76da-a800-7bd9-9ac6-affd89ffaa61',
  },
  '30': {
    terms: '019b76da-a800-7b50-86a8-7bed7be6aa31',
    content_policy: '019b76da-a800-7c4f-824a-db159a7c0493',
    privacy_policy: '019b76da-a800-733f-bc30-2d6ce11c22ef',
    ai_screening: '019b76da-a800-79eb-be98-067995a373be',
  },
  '31': {
    terms: '019b76da-a800-7090-a0ed-269e049ea116',
    content_policy: '019b76da-a800-7bba-9972-30bc3faecc61',
    privacy_policy: '019b76da-a800-76ac-8e14-c9d07600fd24',
    ai_screening: '019b76da-a800-78ab-b813-8b0ed69b5230',
  },
  '32': {
    terms: '019b76da-a800-76b6-875a-ddf129d39882',
    content_policy: '019b76da-a800-7775-a245-cc0dfb205d11',
    privacy_policy: '019b76da-a800-79cd-baa6-db7d678bf1d4',
    ai_screening: '019b76da-a800-7f24-839b-5842dc5d2fa6',
  },
  '33': {
    terms: '019b76da-a800-7993-8a46-9cd23179fd5a',
    content_policy: '019b76da-a800-7e26-b6b1-679fb31b2f2d',
    privacy_policy: '019b76da-a800-764c-b349-cee25d38bd2d',
    ai_screening: '019b76da-a800-760a-93e5-e347ed05b276',
  },
  '34': {
    terms: '019b76da-a800-75ca-a6a4-ca6ccdfeb913',
    content_policy: '019b76da-a800-79a3-98e8-0e1761efad75',
    privacy_policy: '019b76da-a800-790b-8f1b-cfe2fe9433a4',
    ai_screening: '019b76da-a800-751d-b312-dbc106e7d565',
  },
  '35': {
    terms: '019b76da-a800-7672-9d09-6c81eede59e3',
    content_policy: '019b76da-a800-7698-88c9-66204a5988c2',
    privacy_policy: '019b76da-a800-7ec0-b928-965f35b03d86',
    ai_screening: '019b76da-a800-7fb7-8024-a1aa57ee9b07',
  },
  '36': {
    terms: '019b76da-a800-7233-9ab5-5d7025072237',
    content_policy: '019b76da-a800-71b6-ae58-a3731f5408fa',
    privacy_policy: '019b76da-a800-7122-954f-691ea7b01143',
    ai_screening: '019b76da-a800-7822-832f-04b992499839',
  },
  '37': {
    terms: '019b76da-a800-7edf-9d95-c0cc414b7db9',
    content_policy: '019b76da-a800-7b66-9103-c81481921923',
    privacy_policy: '019b76da-a800-747e-b724-6d75581eb8b9',
    ai_screening: '019b76da-a800-7f5b-9d9e-e8292142412b',
  },
  '38': {
    terms: '019b76da-a800-73d8-8715-713015c5cebd',
    content_policy: '019b76da-a800-7099-bc11-cb2e1051fff2',
    privacy_policy: '019b76da-a800-7ef8-aee7-050ccf25aa40',
    ai_screening: '019b76da-a800-7e9d-9a89-4969d234baab',
  },
  '39': {
    terms: '019b76da-a800-7f1b-8052-dc6e3238f09a',
    content_policy: '019b76da-a800-7190-9b5e-59c01a8c7e13',
    privacy_policy: '019b76da-a800-7419-b4b7-222d0429f9b1',
    ai_screening: '019b76da-a800-7ed7-89b1-85b4439371a0',
  },
  '40': {
    terms: '019b76da-a800-7eda-a0ec-e911c12356a9',
    content_policy: '019b76da-a800-7fe8-8a67-af1367120723',
    privacy_policy: '019b76da-a800-7100-8b43-86136e4daff2',
    ai_screening: '019b76da-a800-70fe-b771-f520763f16c0',
  },
  '41': {
    terms: '019b76da-a800-765f-b79b-fb314964ee83',
    content_policy: '019b76da-a800-76aa-93ee-50493f50f423',
    privacy_policy: '019b76da-a800-7ebd-a79a-e331b1a06c7b',
    ai_screening: '019b76da-a800-7157-a4ed-14ec271a6993',
  },
  '42': {
    terms: '019b76da-a800-7647-824b-ae5abbd72302',
    content_policy: '019b76da-a800-703a-a7a2-559d359350eb',
    privacy_policy: '019b76da-a800-7600-9720-ef34f39174ed',
    ai_screening: '019b76da-a800-7b67-bbf0-335184fc45b0',
  },
  '43': {
    terms: '019b76da-a800-7558-8ad8-02b8a49c37b0',
    content_policy: '019b76da-a800-7f89-8d7b-77dc979d5795',
    privacy_policy: '019b76da-a800-70fe-ad5b-b180adcb06d2',
    ai_screening: '019b76da-a800-7eca-bda2-e2082855c088',
  },
  '44': {
    terms: '019b76da-a800-77b6-9b9d-ef2c5f75ac2e',
    content_policy: '019b76da-a800-739f-8823-2be83ef3783a',
    privacy_policy: '019b76da-a800-75a0-ba45-98db473222eb',
    ai_screening: '019b76da-a800-7f3d-a2f5-4dd2e4e3857a',
  },
  '45': {
    terms: '019b76da-a800-73b1-a166-daad7b5eb9f9',
    content_policy: '019b76da-a800-754d-8339-c9e8389b00ea',
    privacy_policy: '019b76da-a800-71e0-8d05-de3c439990f5',
    ai_screening: '019b76da-a800-7f2d-8151-2b12f1d01d04',
  },
  '46': {
    terms: '019b76da-a800-7009-abce-593a62d1f39a',
    content_policy: '019b76da-a800-7733-947f-fc846073ff44',
    privacy_policy: '019b76da-a800-7310-a386-0c92151713f9',
    ai_screening: '019b76da-a800-79f7-b4f6-d5c982b8919d',
  },
  '47': {
    terms: '019b76da-a800-74c8-83f0-687ab6704c1c',
    content_policy: '019b76da-a800-736c-b011-2dda87d93995',
    privacy_policy: '019b76da-a800-7822-9f19-3576497de9bf',
    ai_screening: '019b76da-a800-7b96-a52a-28df6c2ef780',
  },
  '48': {
    terms: '019b76da-a800-7ea0-8f26-77f51c0d9fc4',
    content_policy: '019b76da-a800-7195-8dcf-be7bfacd10bb',
    privacy_policy: '019b76da-a800-72ec-a697-b6336ad94ade',
    ai_screening: '019b76da-a800-7c25-a261-7e4924608979',
  },
  '49': {
    terms: '019b76da-a800-7dd3-92e1-e0346e154bab',
    content_policy: '019b76da-a800-7ca1-bac8-4fd1e76ad6de',
    privacy_policy: '019b76da-a800-7eb8-9416-580dc6bb6cd6',
    ai_screening: '019b76da-a800-7e13-923f-0731c2fde7b1',
  },
} as const;

/** The fixed ids of the avatar uploads of users 01 to 30: `seedId('avatar-upload', NN, SEED_FIXED_AT)`. */
export const SEED_AVATAR_UPLOAD_IDS = {
  '01': '019b76da-a800-7448-9ccf-53b5ffaa9c4b',
  '02': '019b76da-a800-73a6-a905-77891dee9638',
  '03': '019b76da-a800-76fe-903b-5e383fdc7df4',
  '04': '019b76da-a800-78b7-8df6-1c2775749389',
  '05': '019b76da-a800-7e2c-be8a-4fc7e3a63052',
  '06': '019b76da-a800-72a8-a2e7-b128c441cd9e',
  '07': '019b76da-a800-76f4-8765-76076ac07c81',
  '08': '019b76da-a800-764b-b6dc-7dbe7e55b7ff',
  '09': '019b76da-a800-7c84-82df-b5a23042d6bb',
  '10': '019b76da-a800-7c0f-9d4e-ea24d3d804b1',
  '11': '019b76da-a800-7f88-b321-eee1b391298b',
  '12': '019b76da-a800-73e7-ac8c-d26fe9fdb8b8',
  '13': '019b76da-a800-7475-a7d5-4fe234134917',
  '14': '019b76da-a800-7d16-8dcc-acf98a822687',
  '15': '019b76da-a800-7754-bcbb-38e7ce4be30d',
  '16': '019b76da-a800-773c-8a7c-3c9de69a8059',
  '17': '019b76da-a800-7692-a58b-81b921781b89',
  '18': '019b76da-a800-7782-b12f-9bf52fabf524',
  '19': '019b76da-a800-7d0e-a925-d4e912171fc2',
  '20': '019b76da-a800-78cd-bd7a-e071464fc94f',
  '21': '019b76da-a800-7faf-8bd9-875481181f47',
  '22': '019b76da-a800-7eae-815d-690c9c95ebf8',
  '23': '019b76da-a800-7601-a845-516b96094130',
  '24': '019b76da-a800-7284-a982-98fdc96a95da',
  '25': '019b76da-a800-7882-a2ba-b0c47e9fadce',
  '26': '019b76da-a800-72ef-a3df-c31c8569770f',
  '27': '019b76da-a800-7b2a-b3eb-d2db0e756b38',
  '28': '019b76da-a800-7179-9dbf-035e6bb8ad3a',
  '29': '019b76da-a800-7f3b-bb9c-af48e3052a78',
  '30': '019b76da-a800-74c5-bbd9-9a481b8188e9',
} as const;

const RAND_B_BITS = 62n;
const RAND_B_MASK = (1n << RAND_B_BITS) - 1n;
const MAX_UNIX_MS = 2 ** 48 - 1;

/**
 * A version 7 uuid for a time-sensitive seed or test row (TC-08): its 48-bit time field is `at`'s
 * Unix millisecond and its 74 random bits are the first 74 bits of SHA-256 of `<kind>:<ordinal>`,
 * the first 12 in `rand_a` and the next 62 in `rand_b`. Throws RangeError for an invalid date, a
 * time outside the 48-bit field or an ordinal that is not a non-negative integer.
 */
export function seedId(kind: string, ordinal: number, at: Date): string {
  const ms = at.getTime();
  if (!Number.isInteger(ms) || ms < 0 || ms > MAX_UNIX_MS) {
    throw new RangeError('seedId needs a valid date inside the 48-bit time field');
  }
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) {
    throw new RangeError('seedId needs a non-negative integer ordinal');
  }
  const digest = createHash('sha256')
    .update(`${kind}:${String(ordinal)}`)
    .digest();
  // The first 80 bits of the digest; the top 74 of them are the random bits.
  const first80 = BigInt(`0x${digest.subarray(0, 10).toString('hex')}`);
  const random74 = first80 >> 6n;
  const randA = random74 >> RAND_B_BITS;
  const randB = random74 & RAND_B_MASK;

  const time = ms.toString(16).padStart(12, '0');
  const versionAndRandA = (0x7000n | randA).toString(16).padStart(4, '0');
  const variantAndRandB = ((0b10n << RAND_B_BITS) | randB).toString(16).padStart(16, '0');
  return [
    time.slice(0, 8),
    time.slice(8, 12),
    versionAndRandA,
    variantAndRandB.slice(0, 4),
    variantAndRandB.slice(4),
  ].join('-');
}
