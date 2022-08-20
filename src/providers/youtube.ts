import axios from 'axios';
import puppeteer, { Browser } from 'puppeteer';
import ytdl, { videoInfo } from 'ytdl-core';

import { Option, SearchResult, Song, SongData, SongProvider } from '../typings';
import { songDataCache } from '../util/database';
import { formatSeconds } from '../util/duration';
import { randomElement, randomInteger } from '../util/random';
import { getCachedSong } from '../util/search';

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
		related: relatedId,
	};
}

async function getVideoIdFromQuery(query: string): Promise<Option<string>> {
	if (query === '!random') {
		const count = await songDataCache.count({});
		if (count === 0) return null;

		const [song] = await songDataCache
			.find({})
			.sort({ _id: 1 })
			.skip(randomInteger(count))
			.limit(1)
			.exec();

		return song?.id ?? null;
	}

	const result = await axios.get<string>('https://www.youtube.com/results', {
		params: {
			search_query: query,
			sp: 'EgIQAQ==',
		},
	});

	return result.data.match(/\/watch\?v=([\w-]{11})/)?.[1] ?? null;
}

export async function handleYouTubeQuery(
	query: string,
	single = false
): Promise<Option<SearchResult>> {
	if (single) {
		const videoId = await getVideoIdFromQuery(query);
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
		await ytdl.getBasicInfo(`https://www.youtube.com/watch?v=${id}`, {
			requestOptions: {
				headers: {
					Cookie:
						'VISITOR_INFO1_LIVE=T_VAI0yBFOY; PREF=tz=America.Toronto&f6=40000000; SID=NQivUHYSJZ8FLfUbaBCICmPAYWoA__61Re_1ME-HRDm_7TjtFOPjd2kQUFCoClC5V40YuQ.; __Secure-1PSID=NQivUHYSJZ8FLfUbaBCICmPAYWoA__61Re_1ME-HRDm_7Tjtyx-dRfxVWZQ00xP7mraFPQ.; __Secure-3PSID=NQivUHYSJZ8FLfUbaBCICmPAYWoA__61Re_1ME-HRDm_7TjtrZ5d1J7-CDiETHJ9cEqxuQ.; HSID=Aa-D4ML5NJt_-a8ox; SSID=A6YQW6xXjVrCFncOs; APISID=iWRw5OkxX9SQ8OMB/ACenrBIZYU15shrid; SAPISID=vDYSTPQ7LXMvv_ei/A04dqrDY1YUp_7iDb; __Secure-1PAPISID=vDYSTPQ7LXMvv_ei/A04dqrDY1YUp_7iDb; __Secure-3PAPISID=vDYSTPQ7LXMvv_ei/A04dqrDY1YUp_7iDb; LOGIN_INFO=AFmmF2swRQIgVQc3KgCp0x_p2a4w0SivGG0psshLQ7okahYBjqgqZagCIQCda8bH46ayokGA7DqLmR17eY7XznSzcDwgtqOFyr9FKA:QUQ3MjNmeUpGWUpNa0hLekRqNElFUUtaeDRVSllWN1lmV1g5dHF2aEswTHc2OHVzbHF1MUlpT3Z0N19DaG1DWk01c2hmTEJWc3h4TTZUZHh4ZEg0c2ttV1Rqb0hDYWI1LWFhSjRmY1ZQZUtWWDZPSm9SYXptWlNpWXlKemRyV01qeldEVXdFLUVYT1NKeUJoWTJONmpHOWl0Q1AxcUplLUJ3; SIDCC=AEf-XMRcNWj0DqkN7BpSdp_vCiYIC-pSNxQ2Y1RnLOYPt66rVmqQ3j_Pj1wmtMdNpB4KkdHJwOM; __Secure-1PSIDCC=AEf-XMTbmr-oxNIxMFIMaWTmwIPmPc61qCvEjK-AM4xo4WZ67QsSV_71de2m7EHVTrrXi1GNnZ0; __Secure-3PSIDCC=AEf-XMTRFvNkaRctP5tYZKnF5ufwkWFgv88h3S1AVdT6sERVvfhLXYMj1Awqwh5BkkEV6N0SRg4; YSC=knS7AeFOZTI; wide=1',
					'User-Agent':
						'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:103.0) Gecko/20100101 Firefox/103.0',
				},
			},
		})
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
	const browser = await puppeteer.launch();
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
					const data: SongData = {
						url: `https://www.youtube.com/watch?v=${id}`,
						id,
						title: title!,
						duration: time,
						thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
						live: false,
						type: SongProvider.YouTube,
					};

					await songDataCache.insert(data).catch(() => {});

					return data;
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

		try {
			await page.waitForFunction(
				`document.querySelectorAll('div[id=content]').length > ${number}`
			);
		} catch {
			break;
		}
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

	browser.close();

	return data;
}
