const crypto = require('node:crypto');
const { URL } = require('node:url');

function sign(url) {
	const date = new Date();
	const year = date.getUTCFullYear();
	const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
	const day = date.getUTCDate().toString().padStart(2, '0');

	const hasher = crypto.createHmac(
		'sha1',
		'8d2899b2aebb97a69a4a85cc991c0b6713a1d9e2'
	);

	hasher.update(`${url.href.replace(/\+/g, '%20')}${year}${month}${day}`);
	const hash = hasher.digest('base64');

	url.searchParams.set('signature', hash);
	url.searchParams.set('signature_protocol', 'sha1');

	return url;
}

const url = new URL('https://www.musixmatch.com/ws/1.1/macro.search');

url.searchParams.set('app_id', 'community-app-v1.0');
url.searchParams.set('format', 'json');
url.searchParams.set('q', 'save your tears for another day');
url.searchParams.set('page_size', '1');

const signed = sign(url);

console.log(signed.href.replace(/\+/g, '%20'));
/*
const lyrics = new URL('https://www.musixmatch.com/ws/1.1/track.lyrics.get');

lyrics.searchParams.set('app_id', 'community-app-v1.0');
lyrics.searchParams.set('format', 'json');
lyrics.searchParams.set('track_id', '-1');

const signedLyrics = sign(lyrics);

console.log(signedLyrics.href.replace(/\+/g, '%20'));*/
