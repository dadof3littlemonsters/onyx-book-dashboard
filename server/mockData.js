// server/mockData.js
// Mock book data for development/fallbacks

const mockBooks = {
    romantasy: [
        {
            id: 1,
            title: "Fourth Wing",
            author: "Rebecca Yarros",
            cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=Fourth+Wing",
            synopsis: "Twenty-year-old Violet Sorrengail was supposed to enter the Scribe Quadrant, living a quiet life among books and history. Now, the commanding general—also known as her tough-as-talons mother—has ordered Violet to join the hundreds of candidates striving to become the elite of Navarre: dragon riders.",
            rating: 4.5,
            pages: 512
        },
        {
            id: 2,
            title: "A Court of Thorns and Roses",
            author: "Sarah J. Maas",
            cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=ACOTAR",
            synopsis: "When nineteen-year-old huntress Feyre kills a wolf in the woods, a terrifying creature arrives to demand retribution. Dragged to a treacherous magical land she knows about only from legends, Feyre discovers that her captor is not truly a beast, but one of the lethal, immortal faeries who once ruled her world.",
            rating: 4.3,
            pages: 432
        },
        {
            id: 3,
            title: "The Seven Husbands of Evelyn Hugo",
            author: "Taylor Jenkins Reid",
            cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=Seven+Husbands",
            synopsis: "Aging and reclusive Hollywood movie icon Evelyn Hugo is finally ready to tell the truth about her glamorous and scandalous life. But when she chooses unknown magazine reporter Monique Grant for the job, no one is more astounded than Monique herself.",
            rating: 4.7,
            pages: 400
        },
        {
            id: 4,
            title: "Book Lovers",
            author: "Emily Henry",
            cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=Book+Lovers",
            synopsis: "Nora Stephens' life is books—she's read them all—and she is not that type of heroine. Not the plucky one, not the laidback dream girl, and especially not the sweetheart. In fact, the only people Nora is a heroine for are her clients, for whom she lands enormous deals as a cutthroat literary agent.",
            rating: 4.4,
            pages: 368
        }
    ],
    highFantasy: [
        {
            id: 5,
            title: "The Name of the Wind",
            author: "Patrick Rothfuss",
            cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=Name+of+Wind",
            synopsis: "Told in Kvothe's own voice, this is the tale of the magically gifted young man who grows to be the most notorious wizard his world has ever seen. The intimate narrative of his childhood in a troupe of traveling players, his years spent as a near-feral orphan in a crime-ridden city, his daringly brazen yet successful bid to enter a legendary school of magic.",
            rating: 4.6,
            pages: 672
        },
        {
            id: 6,
            title: "The Way of Kings",
            author: "Brandon Sanderson",
            cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=Way+of+Kings",
            synopsis: "Roshar is a world of stone and storms. Uncanny tempests of incredible power sweep across the rocky terrain so frequently that they have shaped ecology and civilization alike. Animals hide in shells, trees pull in branches, and grass retracts into the soilless ground.",
            rating: 4.8,
            pages: 1007
        },
        {
            id: 7,
            title: "The Blade Itself",
            author: "Joe Abercrombie",
            cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=Blade+Itself",
            synopsis: "Logen Ninefingers, infamous barbarian, has finally run out of luck. Caught in one feud too many, he's on the verge of becoming a dead barbarian—leaving nothing behind him but bad songs, dead friends, and a lot of happy enemies.",
            rating: 4.2,
            pages: 515
        },
        {
            id: 8,
            title: "The Final Empire",
            author: "Brandon Sanderson",
            cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=Final+Empire",
            synopsis: "For a thousand years the ash fell and no flowers bloomed. For a thousand years the Skaa slaved in misery and lived in fear. For a thousand years the Lord Ruler, the 'Sliver of Infinity,' reigned with absolute power and ultimate terror, divinely invincible.",
            rating: 4.7,
            pages: 541
        }
    ],
    sciFi: [
        {
            id: 9,
            title: "Dune",
            author: "Frank Herbert",
            cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=Dune",
            synopsis: "Set on the desert planet Arrakis, Dune is the story of the boy Paul Atreides, heir to a noble family tasked with ruling an inhospitable world where the only thing of value is the 'spice' melange, a drug capable of extending life and enhancing consciousness.",
            rating: 4.5,
            pages: 688
        },
        {
            id: 10,
            title: "The Expanse: Leviathan Wakes",
            author: "James S.A. Corey",
            cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=Leviathan+Wakes",
            synopsis: "Humanity has colonized the solar system—Mars, the Moon, the Asteroid Belt and beyond—but the stars are still out of our reach. Jim Holden is XO of an ice miner making runs from the rings of Saturn to the mining stations of the Belt.",
            rating: 4.4,
            pages: 561
        },
        {
            id: 11,
            title: "Neuromancer",
            author: "William Gibson",
            cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=Neuromancer",
            synopsis: "The Matrix is a world within the world, a global consensus-hallucination, the representation of every byte of data in cyberspace. Case had been the sharpest data-thief in the business, until vengeful former employers crippled his nervous system.",
            rating: 4.1,
            pages: 271
        },
        {
            id: 12,
            title: "Project Hail Mary",
            author: "Andy Weir",
            cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=Project+Hail+Mary",
            synopsis: "Ryland Grace is the sole survivor on a desperate, last-chance mission—and if he fails, humanity and the earth itself will perish. Except that right now, he doesn't know that. He can't even remember his own name, let alone the nature of assignment.",
            rating: 4.6,
            pages: 496
        }
    ],
    palateCleanser: [
        {
            id: 13,
            title: "The Undead Day One",
            author: "RR Haywood",
            cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=Undead+Day+One",
            synopsis: "The first day of the zombie apocalypse. Follow the survivors as they struggle through the first twenty-four hours of hell on earth. Post-apocalyptic horror at its finest.",
            rating: 4.3,
            pages: 312
        },
        {
            id: 14,
            title: "Zombie Fallout",
            author: "Mark Tufo",
            cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=Zombie+Fallout",
            synopsis: "It was a flu season like no other. The H1N1 virus had been tampered with and the new and improved strain was airborne, fast acting and worse still, necrotizing. Military horror meets zombie apocalypse.",
            rating: 4.2,
            pages: 298
        },
        {
            id: 15,
            title: "Extraction Point",
            author: "RR Haywood",
            cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=Extraction+Point",
            synopsis: "A covert military operation goes wrong in the heart of zombie-infested London. Military horror and post-apocalyptic survival combine in this intense thriller.",
            rating: 4.4,
            pages: 356
        },
        {
            id: 16,
            title: "Indian Hill",
            author: "Mark Tufo",
            cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=Indian+Hill",
            synopsis: "The zombie apocalypse continues as Mike Talbot fights to keep his family alive in a world gone mad. Military tactics meet horror survival.",
            rating: 4.1,
            pages: 324
        }
    ]
};

module.exports = { mockBooks };
