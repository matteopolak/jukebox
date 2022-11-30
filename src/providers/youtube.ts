import axios from 'axios';
import puppeteer from 'puppeteer';
import ytdl, { videoInfo } from 'ytdl-core';
import fs from 'fs/promises';

import {
	Option,
	SearchResult,
	Song,
	SongData,
	SongProvider,
} from '../typings/common.js';
import { Database } from '../util/database';
import { formatSeconds } from '../util/duration';
import { randomElement, randomInteger } from '../util/random';
import { getCachedSong } from '../util/search';

export const ID_REGEX = /^[\w-]{11}$/;

function videoInfoToSongData(data: videoInfo): SongData {
	const info = data.videoDetails;
	const related = data.related_videos.filter(v => v?.id);

	const song = {
		id: info.videoId,
		url: info.video_url,
		title: info.title,
		artist: // prettier-ignore
		// @ts-ignore
		(data.response?.contents?.twoColumnWatchNextResults?.results?.results?.contents?.find(
				(c: any) => c.videoSecondaryInfoRenderer
			)?.videoSecondaryInfoRenderer?.owner?.videoOwnerRenderer?.title.runs[0]
				?.text ?? data.videoDetails.author.name).replace(
					' - Topic',
					''
				),
		thumbnail: `https://i.ytimg.com/vi/${info.videoId}/hqdefault.jpg`,
		duration: formatSeconds(parseInt(info.lengthSeconds)),
		live: info.isLiveContent,
		type: SongProvider.YouTube,
		format: info.isLiveContent
			? ytdl.chooseFormat(data.formats, {})
			: undefined,
		// only provide an array of related videos if there is at least one
		related: related.length > 0 ? related.map(v => v.id!) : undefined,
	};

	const metadata =
		// @ts-ignore
		data.response?.engagementPanels
			.find(
				(i: any) =>
					i.engagementPanelSectionListRenderer?.header
						?.engagementPanelTitleHeaderRenderer?.title?.simpleText ===
					'Description'
			)
			?.engagementPanelSectionListRenderer.content.structuredDescriptionContentRenderer.items.find(
				(i: any) =>
					i?.videoDescriptionMusicSectionRenderer?.sectionTitle?.simpleText ===
					'Music'
			);

	if (metadata) {
		for (const item of metadata.videoDescriptionMusicSectionRenderer
			?.carouselLockups[0]?.carouselLockupRenderer?.infoRows ?? []) {
			const content =
				item.infoRowRenderer?.defaultMetadata?.simpleText ??
				item.infoRowRenderer?.expandedMetadata?.simpleText ??
				item.infoRowRenderer?.defaultMetadata?.runs[0]?.text;

			switch (item.infoRowRenderer.title.simpleText) {
				case 'SONG':
					song.title = content;

					break;
				case 'ARTIST':
					song.artist = content;

					break;
			}
		}
	}

	return song;
}

async function getVideoIdFromQuery(query: string): Promise<Option<string>> {
	if (query === '?random') {
		const count = await Database.cache.countDocuments();
		if (count === 0) return null;

		const [song] = await Database.cache
			.find({})
			.sort({ _id: 1 })
			.skip(randomInteger(count))
			.limit(1)
			.toArray();

		return song?.id ?? null;
	}

	const result = await axios.get<string>('https://www.youtube.com/results', {
		params: {
			search_query: query,
			sp: 'EgIQAQ==',
		},
	});

	if (result.status !== 200 && result.status !== 304) return null;

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
						'VISITOR_INFO1_LIVE=T_VAI0yBFOY; PREF=tz=America.Toronto&f6=40000000; SID=NQivUHYSJZ8FLfUbaBCICmPAYWoA__61Re_1ME-HRDm_7TjtFOPjd2kQUFCoClC5V40YuQ.; __Secure-1PSID=NQivUHYSJZ8FLfUbaBCICmPAYWoA__61Re_1ME-HRDm_7Tjtyx-dRfxVWZQ00xP7mraFPQ.; __Secure-3PSID=NQivUHYSJZ8FLfUbaBCICmPAYWoA__61Re_1ME-HRDm_7TjtrZ5d1J7-CDiETHJ9cEqxuQ.; HSID=Aa-D4ML5NJt_-a8ox; SSID=A6YQW6xXjVrCFncOs; APISID=iWRw5OkxX9SQ8OMB/ACenrBIZYU15shrid; SAPISID=vDYSTPQ7LXMvv_ei/A04dqrDY1YUp_7iDb; __Secure-1PAPISID=vDYSTPQ7LXMvv_ei/A04dqrDY1YUp_7iDb; __Secure-3PAPISID=vDYSTPQ7LXMvv_ei/A04dqrDY1YUp_7iDb; LOGIN_INFO=AFmmF2swRQIgP9pMl-otPZiW2NAELUSEipK0Rt4ZkJWkcfvnSkkAI2UCIQCn8K2ab4izDUcLILL9604Rm5GJfRGF-4D-IYa8EEKmMw:QUQ3MjNmekhzNzJBV0VlZ2M0X0lGOU1oWkVqYzZJWW9YV3FkODhFZDcteXhMZ2MtUjR4WHNZWEFTVHJ4NndvSFRlUktnU2U0ZVBmN3BtbjdwNTh0TkhZNU4yZnNsV2pSb0p1QXNaby1VdWJvRTkyMlhoMzNBNHpnNWdQeHdyaXlBVWNlRG9zLVJtdnFSek51MkFYSVBvZTB1bnFfZTR5M0M2VlJvZ0VoRk5vc0NUM0h4cmdDLWxtYWJSUGYyZ1QyVTQ1SVFBTHRGTU1nR05QX0FCV1JHR1BzTmE3aFBWWVlGUQ==; SIDCC=AEf-XMSLwqkkjmDfquFh1ljbvoow6sf2w61VMa6mbaxCKr8ZJD_oangQsJSepTZyneU3qWXbAU0; __Secure-1PSIDCC=AEf-XMQQXXMvbDEGMyUdBbKZUtYjhbGvr4QLQD-LNANXdMbQ97vfO39bigtKkKPTyf1CtCq43bs; __Secure-3PSIDCC=AEf-XMQn1V1cTJ4-_RC0kLhXvk6aCUfvocmygBww1yaVcY3T5cVKL2x64zy5FqSYvFXsXf82tkc; YSC=9kBInpCgI7U; CONSISTENCY=AGXVzq9JPuaYi-KyiAYK4d1cvX_3MaSlmWTWn_Us6bbFD8z1mJ2WKkkc_BAplF4aF9qVmqBQfyleC-C30YcRfjPLGNeAaedy4rLEh_FIZe_QAEGds_PPaQUuzF62MoypePmzdBU7skfKgSIQw3hJ0j2G; ST-91les4=itct=CNkCENwwIhMI9J2uss_W-QIVy7mCCh1y0AR7MgpnLWhpZ2gtcmVjWg9GRXdoYXRfdG9fd2F0Y2iaAQYQjh4YngE%3D&csn=MC4wNTIxNDA4NDM3Mjg5NzE4NzU.&endpoint=%7B%22clickTrackingParams%22%3A%22CNkCENwwIhMI9J2uss_W-QIVy7mCCh1y0AR7MgpnLWhpZ2gtcmVjWg9GRXdoYXRfdG9fd2F0Y2iaAQYQjh4YngE%3D%22%2C%22commandMetadata%22%3A%7B%22webCommandMetadata%22%3A%7B%22url%22%3A%22%2Fwatch%3Fv%3DzE-a5eqvlv8%22%2C%22webPageType%22%3A%22WEB_PAGE_TYPE_WATCH%22%2C%22rootVe%22%3A3832%7D%7D%2C%22watchEndpoint%22%3A%7B%22videoId%22%3A%22zE-a5eqvlv8%22%2C%22watchEndpointSupportedOnesieConfig%22%3A%7B%22html5PlaybackOnesieConfig%22%3A%7B%22commonConfig%22%3A%7B%22url%22%3A%22https%3A%2F%2Frr4---sn-gvbxgn-tt1s.googlevideo.com%2Finitplayback%3Fsource%3Dyoutube%26orc%3D1%26oeis%3D1%26c%3DWEB%26oad%3D3200%26ovd%3D3200%26oaad%3D11000%26oavd%3D11000%26ocs%3D700%26oewis%3D1%26oputc%3D1%26ofpcc%3D1%26rbqsm%3Dfr%26msp%3D1%26odeak%3D1%26odepv%3D1%26osfc%3D1%26id%3Dcc4f9ae5eaaf96ff%26ip%3D167.100.66.131%26initcwndbps%3D1175000%26mt%3D1661039588%26oweuc%3D%26pxtags%3DCg4KAnR4EggyNDE5NzI3Ng%26rxtags%3DCg4KAnR4EggyNDE5NzI3NQ%252CCg4KAnR4EggyNDE5NzI3Ng%252CCg4KAnR4EggyNDE5NzI3Nw%22%7D%7D%7D%7D%7D',
					'User-Agent':
						'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:103.0) Gecko/20100101 Firefox/103.0',
				},
			},
		})
	);

	await Database.addSongToCache(data);

	return {
		videos: [data],
		title: null,
	};
}

export async function handleYouTubePlaylist(
	id: string
): Promise<Option<SearchResult>> {
	const browser = await puppeteer.launch({
		args: ['--no-sandbox', '--disable-setuid-sandbox'],
	});

	const page = await browser.newPage();

	await page.goto(`https://www.youtube.com/playlist?list=${id}`, {
		waitUntil: 'networkidle2',
	});

	const videoCount = parseInt(
		(
			await page.evaluate(
				element => element!.textContent!,
				await page.$(
					'yt-formatted-string[class="byline-item style-scope ytd-playlist-byline-renderer'
				)
			)
		)
			.split(' ')
			.shift()!
	);
	const scrolls = Math.ceil(videoCount / 100) - 1;

	const count = async () =>
		(await page.$$('.ytd-playlist-video-renderer#content')).length;
	const scrape = async () => {
		const videos = await page.$$('.ytd-playlist-video-renderer#content');

		const times = await Promise.all(
			videos.slice(1).map(async div => {
				try {
					const [time, title, link, artist] = await Promise.all([
						page.evaluate(
							e =>
								e
									.querySelector(
										'span[class="style-scope ytd-thumbnail-overlay-time-status-renderer"]'
									)!
									.textContent!.trim(),
							div
						),
						page.evaluate(
							e =>
								e.querySelector('a[id="video-title"]')!.getAttribute('title'),
							div
						),
						page.evaluate(
							e =>
								e
									.querySelector(
										'a[class="yt-simple-endpoint style-scope ytd-playlist-video-renderer"]'
									)!
									.getAttribute('href'),
							div
						),
						page.evaluate(
							e =>
								e.querySelector(
									'a[class="yt-simple-endpoint style-scope yt-formatted-string"]'
								)!.textContent,
							div
						),
					]);

					const id = link!.slice(9, 20);
					const data: SongData = {
						url: `https://www.youtube.com/watch?v=${id}`,
						id,
						title: title!,
						artist: artist!,
						duration: time,
						thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
						live: false,
						type: SongProvider.YouTube,
					};

					await Database.addSongToCache(data);

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
			await page.$('.yt-sans-28')
		),
	};

	browser.close();

	return data;
}
