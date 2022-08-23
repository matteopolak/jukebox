import { Option, SearchResult, SongData, SongProvider } from '../typings';
import { parseDocument } from 'htmlparser2';
import { Element } from 'domhandler';
import axios from 'axios';
import { handleYouTubeQuery } from './youtube';
import puppeteer from 'puppeteer';

const META_TAGS = new Set(['og:title', 'og:description', 'og:image']);

export async function handleSpotifyVideo(
	id: string
): Promise<Option<SearchResult>> {
	const { data: html, status } = await axios.get(
		`https://open.spotify.com/track/${id}`
	);

	if (status !== 200 && status !== 304) return null;

	const document = parseDocument(html);
	const meta = new Map<string, string>();

	const children = (
		(document.children[0].next! as Element).children[0] as Element
	).children as Element[];

	for (const child of children) {
		if (!META_TAGS.has(child.attribs.property)) continue;
		if (META_TAGS.size <= meta.size) break;

		meta.set(child.attribs.property, child.attribs.content);
	}

	if (meta.size !== META_TAGS.size) return null;

	const data = await handleYouTubeQuery(
		`${meta.get('og:title')} - ${meta.get('og:description')}`
	);

	if (data) {
		data.videos[0].thumbnail = meta.get('og:image')!;
		data.videos[0].title = meta.get('og:title')!;
		data.videos[0].type = SongProvider.Spotify;
	}

	return data;
}

export async function handleSpotifyAlbum(
	id: string,
	type: 'album' | 'playlist'
): Promise<Option<SearchResult>> {
	const browser = await puppeteer.launch();
	const page = await browser.newPage();

	await page.setViewport({
		width: 1080,
		height: 30000,
		deviceScaleFactor: 0.1,
	});

	await page.goto(`https://open.spotify.com/${type}/${id}`, {
		waitUntil: 'networkidle2',
	});

	const title = await page.evaluate(
		type === 'album'
			? e => e.children[4].children[1].textContent
			: e => e.children[1].children[1].textContent,
		(await page.$('.contentSpacing'))!
	);

	const elements = await page.$$('div[role="row"]');

	// Remove the first entry
	elements.shift();

	const tracks: [string, string][] = [];

	for (const element of elements) {
		const [title, artist] = await page.evaluate(e => {
			const text = [];
			const elements = e.querySelectorAll('.standalone-ellipsis-one-line');

			for (const element of elements) {
				text.push(element.textContent);
			}

			return text;
		}, element);

		tracks.push([title!, artist!]);
	}

	const resolved = (
		await Promise.all(
			tracks.map(async ([title, artist]) => {
				const result = await handleYouTubeQuery(`${artist} - ${title}`, true);
				if (result === null) return null;

				result.videos[0].type = SongProvider.Spotify;
				result.videos[0].title = title;
				result.videos[0].artist = artist;

				return result.videos[0];
			})
		)
	).filter(s => s !== null) as SongData[];

	return {
		title,
		videos: resolved,
	};
}
