import { Readable } from 'node:stream';
import axios, { AxiosResponse } from 'axios';
import { Language, Option } from '../typings/common.js';

const SPLIT_REGEX = /.{1,200}(?=$|\s)/g;

function* splitText(text: string, language: Language) {
	const matches = text.replace(/[\r\n]/g, ' ').matchAll(SPLIT_REGEX);

	let index = 0;

	for (const [match] of matches) {
		yield `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(
			match
		)}&tl=${language}&idx=${index++}&total=${index}&textlen=${
			match.length
		}&client=tw-ob&prev=input&ttsspeed=1`;
	}
}

async function* textToAudioGenerator(text: string, language: Language = 'en') {
	const urls = splitText(text, language);
	let next: Option<Promise<AxiosResponse<Readable, unknown>>> = null;

	for (const url of urls) {
		if (next === null) {
			const url = urls.next().value;

			if (url) {
				next = axios.get<Readable>(url, {
					responseType: 'stream',
				});
			} else {
				break;
			}
		}

		const streamPromise = next;

		next = axios.get<Readable>(url, {
			responseType: 'stream',
		});

		const stream = await streamPromise;

		for await (const chunk of stream.data) {
			yield chunk as Buffer;
		}
	}

	if (next) {
		for await (const chunk of (await next).data) {
			yield chunk as Buffer;
		}
	}
}

export function textToAudioStream(text: string, language: Language = 'en') {
	return Readable.from(textToAudioGenerator(text, language));
}
