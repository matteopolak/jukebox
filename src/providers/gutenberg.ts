import {
	GutenbergBook,
	GutenbergResponse,
	Option,
	SearchResult,
	SongData,
	SongProvider,
} from '../typings';
import axios from 'axios';

export async function search(query: string): Promise<Option<SearchResult>> {
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
	if (!book) return null;

	return {
		title: null,
		videos: [
			{
				url: book.formats['text/plain'],
				id: book.id.toString(),
				title: book.title,
				artist: book.authors?.[0].name ?? '?',
				duration: 'N/A',
				type: SongProvider.Gutenberg,
				thumbnail: book.formats['image/jpeg'],
				live: false,
			},
		],
	};
}
