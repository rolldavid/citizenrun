import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  htmlEntities: false,
});

/**
 * The document as plain objects: attributes under `@_<name>`, and every element and attribute
 * value the string the file holds, never a number, so a quote is the element as written.
 */
export function parseXml(text: string): unknown {
  return parser.parse(text) as unknown;
}
