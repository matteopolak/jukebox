import { Readable } from 'node:stream';
import axios from 'axios';
import { Language } from '../typings/common.js';

const SPLIT_REGEX = /[^\s\uFEFF\xA0!"#$%&\'()*+,-./:;<=>?@[\]^_`{|}~]{1,200}/g;

function* splitText(text: string, language: Language) {
	const matches = text.matchAll(SPLIT_REGEX);

	for (const [match] of matches) {
		yield `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(
			match
		)}&tl=${language}&total=1&idx=0&textlen=${
			text.length
		}&client=tw-ob&prev=input&ttsspeed=1`;
	}
}

async function* textToAudioGenerator(text: string, language: Language = 'en') {
	const urls = splitText(text, language);

	for (const url of urls) {
		const stream = await axios.get<Readable>(url, {
			responseType: 'stream',
		});

		for await (const chunk of stream.data) {
			yield chunk as Buffer;
		}
	}
}

export function textToAudioStream(text: string, language: Language = 'en') {
	return Readable.from(textToAudioGenerator(text, language));
}
