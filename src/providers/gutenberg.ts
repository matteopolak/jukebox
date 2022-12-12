import axios from 'axios';

import { TrackProvider } from '@/structures/provider';
import { Result, SearchResult, TrackSource } from '@/typings/common';
import { GutenbergBook, GutenbergResponse } from '@/typings/gutenberg';
import { prisma } from '@/util/database';
import { trackToOkSearchResult } from '@/util/search';

export class GutenbergProvider extends TrackProvider {
	public async search(query: string): Promise<Result<SearchResult>> {
		const { data } = await axios.get<GutenbergResponse<GutenbergBook>>(
			'http://gutendex.com/books/',
			{
				params: {
					search: query,
					sort: 'popular',
					languages: 'en',
				},
			}
		);

		const book = data.results[0];
		if (!book) return { ok: false, error: `No Gutenberg book matched the query \`${query}\`.` };

		const bookId = `gutenberg:book:${book.id}`;

		return trackToOkSearchResult(await prisma.track.upsert({
			where: { uid: bookId },
			update: {},
			create: {
				url: book.formats['text/plain'] ?? book.formats['text/plain; charset=utf-8'],
				uid: bookId,
				title: book.title,
				artist: {
					connectOrCreate: {
						where: { uid: book.authors[0].name },
						create: {
							uid: book.authors[0].name,
							name: book.authors[0].name,
						},
					},
				},
				duration: 0,
				source: TrackSource.Gutenberg,
				thumbnail: book.formats['image/jpeg'].replace('small', 'medium'),
				relatedCount: 0,
			},
			include: {
				artist: true,
			},
		}));
	}
}
