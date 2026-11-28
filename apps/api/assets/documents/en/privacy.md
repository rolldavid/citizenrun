---
version: 2026-11-27
title: Privacy policy
description: How {{appName}} collects, uses, shares and deletes your data.
---

## Who we are

{{appName}} is an open-source, non-commercial service at {{publicUrl}}. It helps people find the elected offices on their ballot and decide whether to run for one. This policy explains what we collect, why, who receives it, how long we keep it and what you can do about it. You can reach us here:

- Email: {{supportEmail}}
- Postal address: {{postalAddress}}

## What we collect

We collect only what the service needs to work:

- **Email address.** The address that comes with your sign-in method: the one you type for an email code, or the one Apple or Google shares when you sign in with them. Apple may give us a private relay address instead of your real one.
- **Profile.** Your handle, name, bio, link and profile photo.
- **Sign-in methods and sessions.** Which sign-in methods your account uses. Session tokens are kept only as hashes, never in readable form.
- **Age record.** How your age was checked and when, and, when your device's app store gave an age signal, the result and where it came from. We never ask for your birth date and never store the raw age signal.
- **Agreements.** Which versions of these documents you agreed to and when.
- **Issue picks.** The issues you choose during sign-up, used to rank your feed.
- **Districts and location precision.** The districts you live in and how precisely you set your location. If you let the app use your device's location, it is used once to find your districts and then discarded. If you type an address, the text is sent to Geoapify for suggestions and to the US Census Geocoder to find your districts, with no identifier attached, and it is not stored.
- **Your activity.** Follows, bookmarks and the offices you say you are running for ("Running"); posts, comments, likes, reposts and reports you file.
- **Direct messages.** The messages and photos you send and receive.
- **Settings.** Your notification and email settings, message settings and similar choices.
- **Device details.** Push notification tokens and your device's time zone, so reminders arrive at the right local time.
- **Export files.** The file made when you ask to export your data.
- **A product event log.** Records of steps such as finishing sign-up, used to see where the app is hard to use.
- **Error reports.** Reports of app crashes and errors, which carry no user id.
- **Network address.** Your network address is used only to limit abuse, and is stored only as a keyed hash that changes every day.

## What is public and what is never public

Public: your handle, name, bio, link and profile photo; your posts, comments and reposts; the people and accounts you follow; and the offices you are running for, when you choose to make them public.

Never public: your issue picks, your location and districts, offices you are running for privately, your bookmarks, the offices you follow and your email address.

## How we use data

We use data to run the service: to show you the offices and people on your ballot, to rank your feed, to deliver messages and reminders, to keep the service safe and to fix problems.

- Your data is never sold.
- It is never used for advertising.
- There is no tracking: the app contains no third-party analytics, advertising or tracking tools.
- Our models never infer your race, religion, health, income or political party.

## Who receives data

These are the only outside parties that receive data from the service, what they receive and why:

- **Railway** hosts the service: the database, stored files and service logs. Its platform request logs may hold network addresses, the paths of requests (including a private calendar feed address) and search text.
- **Tigris**, Railway's file store, holds uploaded and processed files and sees your device's network address when it sends or loads a file.
- **Resend** delivers our email, so it receives your email address and the content of each email we send you, such as sign-in codes and notices.
- **Geoapify** and the **US Census Geocoder** receive address text you type, to suggest addresses and find districts. No identifier is sent with it.
- **Anthropic** reviews some public captions, comments and bios that our filters flag, and some photos held for a second look, with no handle, user id, email or other identifier attached. Direct messages are never sent to it. Anthropic deletes these inputs within 30 days, but may keep flagged content for up to 2 years.
- **The Expo push service** and **Apple and Google push services** deliver notifications to your device. They receive your push token and the notification text, including message previews unless you switch previews off.
- **Apple and Google sign-in** handle the sign-in itself when you choose them. If you sign in with Apple, we keep Apple's refresh token, encrypted, so that we can revoke it when you delete your account.
- **OpenFreeMap**, through **Cloudflare**, serves the map. Your device fetches the map directly, so they receive your device's network address and the area of the map you view.
- **Expo's update service** receives your device's network address, platform and app version when the app checks for an update.
- **GitHub** runs our open-source code and data jobs. It receives pseudonymous files for training our feed and moderation models, and exports of field reports, none with a user id.
- **The app stores** send us an age signal for your account; we send them nothing.
- **NCMEC** and **law enforcement** receive reports where the law requires it, such as reports of child sexual abuse material.

## Direct messages

Direct messages are not end-to-end encrypted. They are stored on our servers so they can be shown to the two people in the conversation. An admin reads messages only when a member reports a conversation, and then sees only the 10 messages before and after the reported one. Messages are never sent to the AI service and never used for ranking or training. A removed message is kept for 14 days and then deleted.

## What admins can see

A small number of admins run the service. They can see account email addresses, the names of the sign-in providers an account uses, whether an account is suspended and why, the reports filed and the content reported, moderation scores and records, field reports, removal requests and copyright notices. They see a direct message only through a report, as described above. They see the product event log, feed activity and search queries only as totals. Admins cannot see your issue picks, your districts, your bookmarks, offices you are running for privately or the offices you follow.

## Search engines

Office and candidate pages are indexed by search engines. Account pages and post pages are not.

## How long we keep data

- Email address, sign-in methods, age record, agreements and settings: until you delete your account.
- Profile: until you change it or delete your account. A handle you give up is held, as a keyed hash, for 90 days so nobody else can take it at once.
- Session tokens: 90 days after you last use them, and never longer than 1 year.
- Sign-in codes and other one-time sign-in tokens: 1 day.
- Push tokens: 180 days after last use. Delivery receipts: 48 hours.
- Private calendar feed address: until you change or switch off the feed.
- Issue picks, districts and location precision: until you change them.
- Feed weights, which rank your feed: until you delete your account; they fade by 2% each day.
- Bookmarks, follows and likes: until you remove them.
- Posts, comments and reposts: until you delete them. Removed photos and videos are kept for 30 days, except after removals for intimate images, child safety or legal reasons, which delete them at once.
- Direct messages: until deleted. Removed messages are cleared after 14 days, and blocked photos are deleted after 24 hours.
- Uploaded originals: until they are processed. An upload that is never used is deleted after 24 hours.
- Link-preview images: 30 days.
- Notifications: 180 days.
- Reports you file: 1 year after the decision. Copies of reported content kept for review: 90 days after the decision.
- Moderation records: 1 year after they are resolved.
- Field reports: 1 year after the decision.
- Removal requests: the requester's contact details and statement are cleared 1 year after the decision.
- Records of what you saw and did in the feed: 180 days. The list of items already shown to you: 30 days. Prepared feeds: 24 hours.
- Search queries: 90 days, with no user id.
- The product event log: 180 days.
- Error reports: 14 days, with no user id.
- Abuse-limit records holding a hashed network address: about 2 days.
- Export files: 24 hours. The record of an export request: 30 days.
- Material under a legal hold: 365 days.
- Database backups: 14 daily copies, and platform backups for up to 27 days.
- The log used to repeat deletions after a restore: 35 days.
- Keyed hashes of a suspended identity, used to stop it signing up again: permanently, or 1 year for an account closed because its owner was under 18.
- Help offers, claims and copyright notices against your account: until you delete your account.
- Service and platform request logs: as long as Railway's plan keeps them.

## Deleting your account

You can delete your account in settings, on your phone or on the web. Deletion finishes within 24 hours and cannot be undone. The other person in each of your conversations loses the conversation too. If you signed in with Apple, we revoke the app's access to your Apple account.

A few things are kept after deletion:

- material under a legal hold;
- resolved reports, with you unlinked from the ones you filed;
- reports about your content, until they are decided and for at most 30 days;
- moderation records;
- keyed hashes of a suspended identity;
- database backups, for up to 27 days;
- a keyed hash of your account id in the log used to repeat deletions after a restore, for 35 days.

## Exporting your data

You can export your data in settings, once a day. The export holds your profile, settings, agreements, age record, issue picks, districts, follows, bookmarks, posts, comments, likes, the messages you can still see and the reports you filed. When the file is ready, the app gives you a download link that lasts 5 minutes. The file is deleted 24 hours after it is ready. We never email it.

## Adults only

{{appName}} is for people aged 18 and over. When you sign up in the phone app, we check the age signal from your device's app store. Where the store gives no signal, and on the web, we record that no check was made. We never ask for your date of birth. If we learn that an account belongs to someone under 18, we suspend it and delete it. If the person is under 13, we delete the account promptly.

## Your choices

- Turn feed personalization on or off.
- Choose which notifications and emails you receive.
- Hide message previews in notifications.
- Choose whether reminders name the office you are running for.
- Remove your location and districts.
- Change or switch off your private calendar feed.
- Unsubscribe from reminder emails with the link in each one.

## How we protect data

All traffic uses HTTPS. Session tokens and sign-in codes are stored only as hashes, and Apple's refresh token is encrypted. Uploaded photos are re-encoded before anyone else can see them. Database backups are encrypted and kept apart from the service. Each part of the service holds only the keys it needs, and our logs leave out email addresses, locations, addresses, message text and search text.

## Do-not-track signals

Do-not-track signals change nothing here, because nothing is tracked.

## Changes to this policy

When we make a material change, we tell you in the app and ask you to agree again. The effective date at the top of this page shows when the current version took effect.

## Reviewing and correcting your data

You can see and correct your profile and settings in the app at any time. You can download everything we hold about you with an export. For anything else, write to the support address at the top of this page.

## Your state privacy rights

Depending on where you live, you may have the right to know what data we hold about you, to correct it, to delete it and to receive a copy you can take elsewhere. You can use most of these rights in the app. To make a request by email, write from the address on your account to:

- Email: {{supportEmail}}

We answer within 45 days.
