import { Artist, PrismaClient, Track } from '@prisma/client';

export const prisma = new PrismaClient();
export type TrackWithArtist = Track & { artist: Artist };

export function updateArtist(data: Artist) {
	return prisma.artist.upsert({
		where: {
			uid: data.uid,
		},
		update: {
			name: data.name,
		},
		create: {
			uid: data.uid,
			name: data.name,
		},
	});
}

export function updateTrack(data: Track): Promise<TrackWithArtist> {
	return prisma.track.upsert({
		where: {
			uid: data.uid,
		},
		update: {
			title: data.title,
			thumbnail: data.thumbnail,
			url: data.url,
			related: data.related,
			relatedCount: data.relatedCount,
		},
		create: {
			uid: data.uid,
			title: data.title,
			artistId: data.artistId,
			type: data.type,
			duration: data.duration,
			url: data.url,
			thumbnail: data.thumbnail,
			relatedCount: 0,
		},
		include: {
			artist: true,
		},
	});
}
