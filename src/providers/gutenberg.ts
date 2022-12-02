import { Result, SearchResult, SongProvider } from '@/typings/common';
import { GutenbergBook, GutenbergResponse } from '@/typings/gutenberg';
import axios from 'axios';

export async function search(query: string): Promise<Result<SearchResult, string>> {
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

	return {
		ok: true,
		value: {
			title: undefined,
			videos: [
				{
					url:
					book.formats['text/plain'] ??
					book.formats['text/plain; charset=utf-8'],
					id: book.id.toString(),
					title: book.title,
					artist: book.authors?.[0].name ?? '?',
					duration: 0,
					type: SongProvider.Gutenberg,
					thumbnail: book.formats['image/jpeg'].replace('small', 'medium'),
					live: false,
				},
			],
		},
	};
}
