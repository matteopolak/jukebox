import { getAllAudioUrls } from 'google-tts-api';
import { Readable } from 'node:stream';
import axios from 'axios';
import { Language } from '../typings';

async function* textToAudioGenerator(text: string, language: Language = 'en') {
	const results = getAllAudioUrls(text, {
		lang: language,
		slow: false,
		host: 'https://translate.google.com',
		splitPunct: ',.?',
	});

	for (const result of results) {
		const stream = await axios.get(result.url, {
			responseType: 'stream',
		});

		for await (const chunk of stream.data) {
			yield chunk;
		}
	}
}

export function textToAudioStream(text: string, language: Language = 'en') {
	return Readable.from(textToAudioGenerator(text, language));
}
