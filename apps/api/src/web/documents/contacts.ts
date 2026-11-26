// The contact placeholders of the documents and their fallbacks (L-legal-docs, D-415 row 14, D-416).
import type { BrandContacts } from '@citizenrun/shared';
import type { PlaceholderValues } from './render.ts';

/**
 * The placeholder values with the fallbacks of L-legal-docs: the DMCA agent and the child-safety
 * contact fall back to the app name, the postal address and the support email. A value still null
 * renders the pending sentence.
 */
export function placeholderValues(input: {
  appName: string;
  publicUrl: string;
  contacts: BrandContacts;
}): PlaceholderValues {
  const { appName, publicUrl, contacts } = input;
  return {
    appName,
    publicUrl,
    supportEmail: contacts.supportEmail,
    postalAddress: contacts.postalAddress,
    dmcaAgentName: contacts.dmcaAgent.name ?? appName,
    dmcaAgentAddress: contacts.dmcaAgent.address ?? contacts.postalAddress,
    dmcaAgentPhone: contacts.dmcaAgent.phone,
    dmcaAgentEmail: contacts.dmcaAgent.email ?? contacts.supportEmail,
    childSafetyContactName: contacts.childSafetyContact.name ?? appName,
    childSafetyContactEmail: contacts.childSafetyContact.email ?? contacts.supportEmail,
  };
}

/** The dotted names of the null contact leaves, for the `contacts_pending` line; never a value. */
export function pendingContactKeys(contacts: BrandContacts): string[] {
  const leaves: readonly [string, string | null][] = [
    ['supportEmail', contacts.supportEmail],
    ['postalAddress', contacts.postalAddress],
    ['dmcaAgent.name', contacts.dmcaAgent.name],
    ['dmcaAgent.address', contacts.dmcaAgent.address],
    ['dmcaAgent.phone', contacts.dmcaAgent.phone],
    ['dmcaAgent.email', contacts.dmcaAgent.email],
    ['childSafetyContact.name', contacts.childSafetyContact.name],
    ['childSafetyContact.email', contacts.childSafetyContact.email],
  ];
  return leaves.filter(([, value]) => value === null).map(([key]) => key);
}
