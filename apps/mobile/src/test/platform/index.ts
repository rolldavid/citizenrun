import { ageAssuranceFake } from './age-assurance';
import { authFake } from './auth';
import { calendarFake } from './calendar';
import { hapticsFake } from './haptics';
import { linksFake } from './links';
import { locationFake } from './location';
import { mapFake } from './map';
import { pdfFake } from './pdf';
import { pushFake } from './push';
import { queryClientFake } from './query-client';
import { sessionFake } from './session';
import { shareFake } from './share';
import { storageFake } from './storage';
import { uploadFake } from './upload';
import { videoFake } from './video';

/** Restores every fake's defaults, empties every `calls` and drops mounted-component references (PM-test-seam). */
export function resetPlatformFakes(): void {
  sessionFake.reset();
  mapFake.reset();
  uploadFake.reset();
  pushFake.reset();
  shareFake.reset();
  locationFake.reset();
  hapticsFake.reset();
  calendarFake.reset();
  authFake.reset();
  pdfFake.reset();
  videoFake.reset();
  storageFake.reset();
  linksFake.reset();
  ageAssuranceFake.reset();
  queryClientFake.reset();
}
