'use strict';

import puppeteer from 'puppeteer';
import { Song } from './music';

export default async function scraper(
	id: string
): Promise<{ title: string; videos: Song[] }> {
	const browser = await puppeteer.launch();
	const page = await browser.newPage();

	await page.goto(`https://www.youtube.com/playlist?list=${id}`, {
		waitUntil: 'networkidle2',
	});

	const videoCount = parseInt(
		(
			await page.evaluate(
				element => element.textContent,
				await page.$(
					'div[id=stats] yt-formatted-string[class="style-scope ytd-playlist-sidebar-primary-info-renderer"]'
				)
			)
		)
			.split(' ')
			.shift()
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
								)
								.textContent.trim(),
						div
					);
					const title = await page.evaluate(
						e => e.querySelector('a[id="video-title"]').getAttribute('title'),
						div
					);
					const link = await page.evaluate(
						e =>
							e
								.querySelector(
									'a[class="yt-simple-endpoint style-scope ytd-playlist-video-renderer"]'
								)
								.getAttribute('href'),
						div
					);

					const id = link.slice(9, 20);

					return {
						url: `https://www.youtube.com${link}`,
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
			e => e.textContent,
			await page.$(
				'a[class="yt-simple-endpoint style-scope yt-formatted-string"]'
			)
		),
	};

	await browser.close();

	return data;
}
