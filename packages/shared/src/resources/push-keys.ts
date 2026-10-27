/**
 * @license
 * Adapted from the Firebase JavaScript SDK, https://github.com/firebase/firebase-js-sdk:
 * the push-ID generator in packages/database/src/core/util/NextPushId.ts, at
 * commit 6cde0c0230b4c1da01d4a058333daa7663322fd1 (@firebase/database 1.1.5).
 * Modified by Television: rewritten as one function that reads the clock
 * itself, draws its random characters from crypto.getRandomValues, and stops
 * the same-millisecond increment at the first character.
 *
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Push keys in the form Firebase uses (specs/arch/resources/json-store.md#^js-arch-push-keys).
const PUSH_KEY_ALPHABET = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";
const TIME_CHARACTERS = 8;
const RANDOM_CHARACTERS = 12;

let lastTime = -1;
const lastRandom: number[] = new Array<number>(RANDOM_CHARACTERS).fill(0);

/**
 * A 20-character key whose first 8 characters encode the client's clock and
 * whose last 12 are random. Keys generated in one millisecond increment the
 * random part of the previous key, so one client's keys sort in creation order.
 */
export function generatePushKey(): string {
  const now = Date.now();
  if (now === lastTime) {
    let position = RANDOM_CHARACTERS - 1;
    while (position >= 0 && lastRandom[position] === PUSH_KEY_ALPHABET.length - 1) {
      lastRandom[position] = 0;
      position--;
    }
    if (position >= 0) lastRandom[position]!++;
  } else {
    lastTime = now;
    const bytes = crypto.getRandomValues(new Uint8Array(RANDOM_CHARACTERS));
    for (let position = 0; position < RANDOM_CHARACTERS; position++) {
      // 256 is a multiple of 64, so masking keeps every character equally likely.
      lastRandom[position] = bytes[position]! & (PUSH_KEY_ALPHABET.length - 1);
    }
  }

  const timeCharacters = new Array<string>(TIME_CHARACTERS);
  let time = now;
  for (let position = TIME_CHARACTERS - 1; position >= 0; position--) {
    timeCharacters[position] = PUSH_KEY_ALPHABET.charAt(time % PUSH_KEY_ALPHABET.length);
    time = Math.floor(time / PUSH_KEY_ALPHABET.length);
  }
  return timeCharacters.join("") + lastRandom.map((index) => PUSH_KEY_ALPHABET.charAt(index)).join("");
}
