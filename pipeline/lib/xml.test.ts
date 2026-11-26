import { describe, expect, it } from 'vitest';
import { parseXml } from './xml.ts';

describe('parseXml', () => {
  it('keeps attributes under @_ as the strings the file holds', () => {
    const doc = parseXml(
      '<Return returnVersion="2023v5.0"><ReturnHeader binaryAttachmentCnt="0"><TaxYr>2024</TaxYr></ReturnHeader></Return>',
    );
    expect(doc).toEqual({
      Return: {
        '@_returnVersion': '2023v5.0',
        ReturnHeader: { '@_binaryAttachmentCnt': '0', TaxYr: '2024' },
      },
    });
  });

  it('keeps a numeric element as written', () => {
    const doc = parseXml(
      '<IRS990><VotingMembersGoverningBodyCnt>09</VotingMembersGoverningBodyCnt><TotalRevenueAmt>1.50e3</TotalRevenueAmt><Flag>true</Flag></IRS990>',
    );
    expect(doc).toEqual({
      IRS990: { VotingMembersGoverningBodyCnt: '09', TotalRevenueAmt: '1.50e3', Flag: 'true' },
    });
  });

  it('decodes the XML entities and leaves HTML entities alone', () => {
    const doc = parseXml('<Name>Fixture &amp; Co &lt;Electric&gt; &eacute;</Name>');
    expect(doc).toEqual({ Name: 'Fixture & Co <Electric> &eacute;' });
  });
});
