import axios from 'axios';
import puppeteer, { Browser } from 'puppeteer';
import ytdl, { videoInfo } from 'ytdl-core';

import { Option, SearchResult, Song, SongData, SongProvider } from '../typings';
import { songDataCache } from '../util/database';
import { formatSeconds } from '../util/duration';
import { randomElement } from '../util/random';
import { getCachedSong, sharedBrowser } from '../util/search';

export const ID_REGEX = /^[\w-]{11}$/;

function videoInfoToSongData(data: videoInfo): SongData {
	const info = data.videoDetails;
	const relatedId = randomElement(data.related_videos.filter(v => v?.id))?.id;

	return {
		id: info.videoId,
		url: info.video_url,
		title: info.title,
		thumbnail: `https://i.ytimg.com/vi/${info.videoId}/hqdefault.jpg`,
		duration: formatSeconds(parseInt(info.lengthSeconds)),
		live: info.isLiveContent,
		type: SongProvider.YouTube,
		format: info.isLiveContent
			? ytdl.chooseFormat(data.formats, {})
			: undefined,
		related: relatedId
			? `https://www.youtube.com/watch?v=${relatedId}`
			: undefined,
	};
}

export async function handleYouTubeQuery(
	query: string,
	single = false
): Promise<Option<SearchResult>> {
	if (single) {
		const result = await axios.get<string>('https://www.youtube.com/results', {
			params: {
				search_query: query,
				sp: 'EgIQAQ==',
			},
		});

		const videoId = result.data.match(/\/watch\?v=([\w-]{11})/)?.[1] ?? null;
		if (videoId === null) return null;

		return handleYouTubeVideo(videoId);
	}

	const names = query.split('\n');
	if (names.length === 1) return handleYouTubeQuery(query, true);

	return {
		videos: (
			await Promise.all(
				names.map(async title => {
					const result = await handleYouTubeQuery(title, true);
					if (result === null) return null;

					return result.videos[0];
				})
			)
		).filter(s => s !== null) as SongData[],
		title: null,
	};
}

export async function handleYouTubeVideo(id: string): Promise<SearchResult> {
	const cached = await getCachedSong(id);
	if (cached) {
		// Remove the unique id
		// @ts-ignore
		cached._id = undefined;

		return {
			videos: [cached],
			title: null,
		};
	}

	const data = videoInfoToSongData(
		await ytdl.getBasicInfo(`https://www.youtube.com/watch?v=${id}`)
	);

	await songDataCache.insert(data);

	return {
		videos: [data],
		title: null,
	};
}

export async function handleYouTubePlaylist(
	id: string
): Promise<Option<SearchResult>> {
	const browser =
		sharedBrowser.browser ?? (sharedBrowser.browser = await puppeteer.launch());

	const page = await browser.newPage();

	await page.goto(`https://www.youtube.com/playlist?list=${id}`, {
		waitUntil: 'networkidle2',
	});

	const videoCount = parseInt(
		(
			await page.evaluate(
				element => element!.textContent!,
				await page.$(
					'div[id=stats] yt-formatted-string[class="style-scope ytd-playlist-sidebar-primary-info-renderer"]'
				)
			)
		)
			.split(' ')
			.shift()!
	);
	const scrolls = Math.ceil(videoCount / 100) - 1;

	const count = async () => (await page.$$('div[id=content]')).length;
	const scrape = async () => {
		const videos = await page.$$('div[id=content]');

		const times = await Promise.all(
			videos.slice(1).map(async div => {
				try {
					const time = await page.evaluate(
						e =>
							e
								.querySelector(
									'span[class="style-scope ytd-thumbnail-overlay-time-status-renderer"]'
								)!
								.textContent!.trim(),
						div
					);
					const title = await page.evaluate(
						e => e.querySelector('a[id="video-title"]')!.getAttribute('title'),
						div
					);
					const link = (await page.evaluate(
						e =>
							e
								.querySelector(
									'a[class="yt-simple-endpoint style-scope ytd-playlist-video-renderer"]'
								)!
								.getAttribute('href'),
						div
					))!;

					const id = link.slice(9, 20);

					return {
						url: `https://www.youtube.com${link}`,
						id,
						title,
						duration: time,
						thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
						live: false,
					};
				} catch {
					return null;
				}
			})
		);

		return times.filter(t => t !== null);
	};

	for (let i = 0; i < scrolls; ++i) {
		const number = await count();

		await page.evaluate(() => {
			window.scrollBy(0, 10500);
		});
		await page.waitForFunction(
			`document.querySelectorAll('div[id=content]').length > ${number}`
		);
	}

	await page.evaluate(() => {
		window.scrollBy(0, 10500);
	});
	await new Promise(r => setTimeout(r, 1000));

	const data = {
		videos: (await scrape()) as Song[],
		title: await page.evaluate(
			e => e!.textContent!,
			await page.$(
				'a[class="yt-simple-endpoint style-scope yt-formatted-string"]'
			)
		),
	};

	await browser.close();

	return data;
}
