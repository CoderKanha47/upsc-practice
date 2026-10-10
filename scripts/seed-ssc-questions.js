/**
 * SSC CGL BUILT-IN PRACTICE SET — AI GENERATED.
 *
 * These are NEW practice questions written for this app so the SSC exam flow
 * (selective practice, sectional timers, analytics) can be exercised before
 * official papers are imported. They are stored with
 * source_type = 'AI_GENERATED' and are NEVER presented as SSC PYQs.
 * Official SSC PYQs enter the database only through the import pipeline.
 */

const AI_SOURCE = 'Built-in SSC practice set (AI generated — not an SSC PYQ)';
const group = (paper) => ({
  exam: 'SSC_CGL',
  paper,
  source_type: 'AI_GENERATED',
  source: AI_SOURCE,
  year: null,
  question_number: null,
  difficulty: 'medium',
});

const R = (q) => ({ ...group('SSC_T1'), subject: 'General Intelligence & Reasoning', ...q });
const A = (q) => ({ ...group('SSC_T1'), subject: 'General Awareness', ...q });
const Q = (q) => ({ ...group('SSC_T1'), subject: 'Quantitative Aptitude', ...q });
const E = (q) => ({ ...group('SSC_T1'), subject: 'English Comprehension', ...q });
const CK = (q) => ({ ...group('SSC_T2_P1'), subject: 'Computer Knowledge', ...q });
const ST = (q) => ({ ...group('SSC_T2_P2'), subject: 'Statistics', ...q });

export const SSC_REASONING_QUESTIONS = [
  R({
    topic: 'Analogy', difficulty: 'easy', question_type: 'logical_reasoning',
    question_text: 'Select the option that is related to the third word in the same way as the second word is related to the first.\nPen : Writer :: Brush : ?',
    options: [{ key: 'A', text: 'Painter' }, { key: 'B', text: 'Carpenter' }, { key: 'C', text: 'Doctor' }, { key: 'D', text: 'Gardener' }],
    correct_answer: 'A',
    explanation: 'A pen is the tool of a writer; a brush is the tool of a painter.',
    concept: 'Tool–worker analogies',
  }),
  R({
    topic: 'Series', difficulty: 'easy', question_type: 'logical_reasoning',
    question_text: 'Find the next term in the series: 3, 6, 11, 18, 27, ___',
    options: [{ key: 'A', text: '36' }, { key: 'B', text: '38' }, { key: 'C', text: '40' }, { key: 'D', text: '42' }],
    correct_answer: 'B',
    explanation: 'Differences are 3, 5, 7, 9, so the next difference is 11 → 27 + 11 = 38.',
    concept: 'Series with increasing differences',
  }),
  R({
    topic: 'Coding-Decoding', difficulty: 'medium', question_type: 'logical_reasoning',
    question_text: 'In a certain code language, TABLE is written as GZYOV. How is CHAIR written in that code?',
    options: [{ key: 'A', text: 'XSZRI' }, { key: 'B', text: 'XSZIR' }, { key: 'C', text: 'XZSRI' }, { key: 'D', text: 'SZXRI' }],
    correct_answer: 'A',
    explanation: 'Each letter is replaced by its opposite in the alphabet (A↔Z, B↔Y …). C→X, H→S, A→Z, I→R, R→I gives XSZRI.',
    concept: 'Opposite-letter (reverse alphabet) coding',
  }),
  R({
    topic: 'Blood Relations', difficulty: 'medium', question_type: 'logical_reasoning',
    question_text: 'A is the brother of B. B is the sister of C. C is the father of D. How is A related to D?',
    options: [{ key: 'A', text: 'Uncle' }, { key: 'B', text: 'Father' }, { key: 'C', text: 'Brother' }, { key: 'D', text: 'Grandfather' }],
    correct_answer: 'A',
    explanation: 'A and B are siblings of C; C is D’s parent, so A is D’s uncle (father’s brother).',
    concept: 'Blood-relation chains',
  }),
  R({
    topic: 'Syllogism', difficulty: 'hard', question_type: 'logical_reasoning',
    question_text: 'Statements:\nI. All cups are plates.\nII. Some plates are saucers.\nConclusions:\n(1) Some cups are saucers.\n(2) All saucers are cups.\nWhich of the conclusions follows?',
    options: [{ key: 'A', text: 'Only (1)' }, { key: 'B', text: 'Only (2)' }, { key: 'C', text: 'Both' }, { key: 'D', text: 'Neither' }],
    correct_answer: 'D',
    explanation: 'The saucers that are plates need not overlap the cups at all; neither conclusion follows validly.',
    concept: 'Syllogistic validity',
  }),
  R({
    topic: 'Order & Ranking', difficulty: 'easy', question_type: 'logical_reasoning',
    question_text: 'In a row of 40 students, Rita is 12th from the left end. What is her position from the right end?',
    options: [{ key: 'A', text: '28th' }, { key: 'B', text: '29th' }, { key: 'C', text: '30th' }, { key: 'D', text: '31st' }],
    correct_answer: 'B',
    explanation: 'Position from right = total − position from left + 1 = 40 − 12 + 1 = 29.',
    concept: 'Ranking from opposite ends',
  }),
  R({
    topic: 'Direction & Distance', difficulty: 'medium', question_type: 'logical_reasoning',
    question_text: 'Ravi walks 4 km north, then turns left and walks 3 km. How far is he from his starting point?',
    options: [{ key: 'A', text: '3 km' }, { key: 'B', text: '4 km' }, { key: 'C', text: '5 km' }, { key: 'D', text: '7 km' }],
    correct_answer: 'C',
    explanation: 'The path forms a right triangle: √(4² + 3²) = 5 km.',
    concept: 'Displacement using the Pythagorean theorem',
  }),
  R({
    topic: 'Venn Diagrams', difficulty: 'easy', question_type: 'logical_reasoning',
    question_text: 'Which diagram best represents the relationship: Furniture, Chair, Table?',
    options: [
      { key: 'A', text: 'Three separate circles' },
      { key: 'B', text: 'Chair and Table inside Furniture, Chair and Table separate' },
      { key: 'C', text: 'Chair inside Table inside Furniture' },
      { key: 'D', text: 'All three overlapping partially' },
    ],
    correct_answer: 'B',
    explanation: 'Chairs and tables are both furniture but are distinct from each other.',
    concept: 'Venn representation of class relations',
  }),
  R({
    topic: 'Non-Verbal Reasoning', difficulty: 'medium', question_type: 'logical_reasoning',
    question_text: 'A piece of paper is folded twice and a hole is punched through all layers. How many holes appear when the paper is fully unfolded?',
    options: [{ key: 'A', text: '1' }, { key: 'B', text: '2' }, { key: 'C', text: '3' }, { key: 'D', text: '4' }],
    correct_answer: 'D',
    explanation: 'Each fold doubles the layers: 2 folds → 4 layers → 4 holes.',
    concept: 'Paper folding and punching',
  }),
  R({
    topic: 'Analogy', difficulty: 'medium', question_type: 'logical_reasoning',
    question_text: 'Doctor : Hospital :: Teacher : ?',
    options: [{ key: 'A', text: 'Library' }, { key: 'B', text: 'School' }, { key: 'C', text: 'Court' }, { key: 'D', text: 'Station' }],
    correct_answer: 'B',
    explanation: 'A doctor works in a hospital; a teacher works in a school.',
    concept: 'Worker–workplace analogies',
  }),
  R({
    topic: 'Logical & Analytical Reasoning', difficulty: 'hard', question_type: 'logical_reasoning',
    question_text: 'If the day before yesterday was Thursday, what day will it be three days after tomorrow?',
    options: [{ key: 'A', text: 'Sunday' }, { key: 'B', text: 'Monday' }, { key: 'C', text: 'Tuesday' }, { key: 'D', text: 'Wednesday' }],
    correct_answer: 'D',
    explanation: 'Day before yesterday = Thursday → yesterday = Friday → today = Saturday → tomorrow = Sunday. Three days after Sunday is Wednesday.',
    concept: 'Calendar day counting',
  }),
  R({
    topic: 'Coding-Decoding', difficulty: 'easy', question_type: 'logical_reasoning',
    question_text: 'In a certain code, MOUSE is written as PRVXH. Each letter moves how many steps forward?',
    options: [{ key: 'A', text: '2' }, { key: 'B', text: '3' }, { key: 'C', text: '4' }, { key: 'D', text: '5' }],
    correct_answer: 'B',
    explanation: 'M→P (+3), O→R (+3), U→X (+3), S→V (+3), E→H (+3).',
    concept: 'Shift cipher with a constant key',
  }),
];

export const SSC_AWARENESS_QUESTIONS = [
  A({
    topic: 'Indian Polity', difficulty: 'easy', question_type: 'factual',
    question_text: 'The Constituent Assembly of India was elected in:',
    options: [{ key: 'A', text: '1944' }, { key: 'B', text: '1945' }, { key: 'C', text: '1946' }, { key: 'D', text: '1947' }],
    correct_answer: 'C',
    explanation: 'The Assembly was elected in 1946 under the Cabinet Mission Plan and first met on 9 December 1946.',
    concept: 'Making of the Indian Constitution',
  }),
  A({
    topic: 'General Science', difficulty: 'easy', question_type: 'factual',
    question_text: 'Which vitamin is produced in the human body on exposure to sunlight?',
    options: [{ key: 'A', text: 'Vitamin A' }, { key: 'B', text: 'Vitamin B12' }, { key: 'C', text: 'Vitamin C' }, { key: 'D', text: 'Vitamin D' }],
    correct_answer: 'D',
    explanation: 'Skin synthesises Vitamin D3 when exposed to UVB radiation from sunlight.',
    concept: 'Vitamins and their sources',
  }),
  A({
    topic: 'Geography', difficulty: 'medium', question_type: 'factual',
    question_text: 'The Indian state with the longest coastline is:',
    options: [{ key: 'A', text: 'Tamil Nadu' }, { key: 'B', text: 'Gujarat' }, { key: 'C', text: 'Andhra Pradesh' }, { key: 'D', text: 'Maharashtra' }],
    correct_answer: 'B',
    explanation: 'Gujarat has the longest coastline of any Indian state (about 1,600 km).',
    concept: 'Coastal geography of India',
  }),
  A({
    topic: 'Economy', difficulty: 'medium', question_type: 'factual',
    question_text: 'NITI Aayog replaced which body?',
    options: [{ key: 'A', text: 'Finance Commission' }, { key: 'B', text: 'Planning Commission' }, { key: 'C', text: 'National Development Council' }, { key: 'D', text: 'Electoral Commission' }],
    correct_answer: 'B',
    explanation: 'NITI Aayog was formed on 1 January 2015 in place of the Planning Commission (1950–2014).',
    concept: 'Economic institutions of India',
  }),
  A({
    topic: 'History', difficulty: 'medium', question_type: 'factual',
    question_text: 'The Quit India Movement was launched in:',
    options: [{ key: 'A', text: '1930' }, { key: 'B', text: '1935' }, { key: 'C', text: '1942' }, { key: 'D', text: '1947' }],
    correct_answer: 'C',
    explanation: 'The Quit India resolution was adopted on 8 August 1942 at the Bombay session of the AICC; mass protests followed on 9 August.',
    concept: 'Key movements of the freedom struggle',
  }),
  A({
    topic: 'Static General Knowledge', difficulty: 'easy', question_type: 'factual',
    question_text: 'The currency of Japan is the:',
    options: [{ key: 'A', text: 'Yuan' }, { key: 'B', text: 'Won' }, { key: 'C', text: 'Yen' }, { key: 'D', text: 'Baht' }],
    correct_answer: 'C',
    explanation: 'Japan uses the yen (¥). The yuan is Chinese, the won Korean and the baht Thai.',
    concept: 'World currencies',
  }),
  A({
    topic: 'Environment', difficulty: 'medium', question_type: 'factual',
    question_text: 'The Montreal Protocol is concerned with:',
    options: [{ key: 'A', text: 'Ozone-depleting substances' }, { key: 'B', text: 'Greenhouse gases only' }, { key: 'C', text: 'Wetland conservation' }, { key: 'D', text: 'Desertification' }],
    correct_answer: 'A',
    explanation: 'The 1987 Montreal Protocol phases out production and consumption of ozone-depleting substances such as CFCs.',
    concept: 'International environmental agreements',
  }),
  A({
    topic: 'Art & Culture', difficulty: 'easy', question_type: 'factual',
    question_text: 'Sattriya is a classical dance form of:',
    options: [{ key: 'A', text: 'Odisha' }, { key: 'B', text: 'Assam' }, { key: 'C', text: 'Manipur' }, { key: 'D', text: 'Kerala' }],
    correct_answer: 'B',
    explanation: 'Sattriya originated in the Vaishnavite monasteries (sattras) of Assam and is one of India’s recognised classical dances.',
    concept: 'Classical dance traditions of India',
  }),
  A({
    topic: 'Current Affairs', difficulty: 'easy', question_type: 'current_affairs',
    question_text: 'India’s Chandrayaan-3 mission achieved a soft landing near which region of the Moon in 2023?',
    options: [{ key: 'A', text: 'Equator' }, { key: 'B', text: 'North pole' }, { key: 'C', text: 'South pole' }, { key: 'D', text: 'Far side, equatorial belt' }],
    correct_answer: 'C',
    explanation: 'Chandrayaan-3’s Vikram lander touched down near the lunar south pole on 23 August 2023, a first for any country.',
    concept: 'India’s space programme',
  }),
  A({
    topic: 'Indian Polity', difficulty: 'medium', question_type: 'factual',
    question_text: 'How many languages are included in the Eighth Schedule of the Constitution?',
    options: [{ key: 'A', text: '18' }, { key: 'B', text: '20' }, { key: 'C', text: '22' }, { key: 'D', text: '24' }],
    correct_answer: 'C',
    explanation: 'The Eighth Schedule lists 22 languages, including Konkani, Nepali, Santhali, Bodo and Dogri added by amendment.',
    concept: 'Constitutional schedules',
  }),
];

export const SSC_QUANT_QUESTIONS = [
  Q({
    topic: 'Percentage', difficulty: 'easy', question_type: 'quantitative',
    question_text: 'What is 25% of 480?',
    options: [{ key: 'A', text: '100' }, { key: 'B', text: '110' }, { key: 'C', text: '120' }, { key: 'D', text: '130' }],
    correct_answer: 'C',
    explanation: '25% = one fourth; 480 ÷ 4 = 120.',
    concept: 'Basic percentage calculation',
  }),
  Q({
    topic: 'Profit & Loss', difficulty: 'medium', question_type: 'quantitative',
    question_text: 'An article bought for ₹800 is sold for ₹920. What is the profit percentage?',
    options: [{ key: 'A', text: '12%' }, { key: 'B', text: '15%' }, { key: 'C', text: '20%' }, { key: 'D', text: '25%' }],
    correct_answer: 'B',
    explanation: 'Profit = ₹120; profit% = (120/800) × 100 = 15%.',
    concept: 'Profit percentage on cost price',
  }),
  Q({
    topic: 'Time Speed & Distance', difficulty: 'medium', question_type: 'quantitative',
    question_text: 'A train 150 m long crosses a pole in 12 seconds. Its speed is:',
    options: [{ key: 'A', text: '35 km/h' }, { key: 'B', text: '40 km/h' }, { key: 'C', text: '45 km/h' }, { key: 'D', text: '50 km/h' }],
    correct_answer: 'C',
    explanation: 'Speed = 150/12 = 12.5 m/s = 12.5 × 18/5 = 45 km/h.',
    concept: 'm/s to km/h conversion in train problems',
  }),
  Q({
    topic: 'Simple & Compound Interest', difficulty: 'medium', question_type: 'quantitative',
    question_text: 'The simple interest on ₹5,000 at 8% per annum for 3 years is:',
    options: [{ key: 'A', text: '₹1,000' }, { key: 'B', text: '₹1,200' }, { key: 'C', text: '₹1,500' }, { key: 'D', text: '₹2,000' }],
    correct_answer: 'B',
    explanation: 'SI = P × R × T / 100 = 5000 × 8 × 3 / 100 = ₹1,200.',
    concept: 'Simple interest formula',
  }),
  Q({
    topic: 'Ratio & Proportion', difficulty: 'easy', question_type: 'quantitative',
    question_text: 'Divide ₹720 in the ratio 5 : 7. The larger share is:',
    options: [{ key: 'A', text: '₹300' }, { key: 'B', text: '₹360' }, { key: 'C', text: '₹400' }, { key: 'D', text: '₹420' }],
    correct_answer: 'D',
    explanation: 'Total parts = 12; one part = ₹60; larger share = 7 × 60 = ₹420.',
    concept: 'Ratio division of a quantity',
  }),
  Q({
    topic: 'Average', difficulty: 'easy', question_type: 'quantitative',
    question_text: 'The average of 8 numbers is 45. If one number, 52, is removed, the new average of the remaining numbers is:',
    options: [{ key: 'A', text: '42' }, { key: 'B', text: '43' }, { key: 'C', text: '44' }, { key: 'D', text: '45' }],
    correct_answer: 'C',
    explanation: 'Total = 360; after removing 52, total = 308 over 7 numbers → 308 ÷ 7 = 44.',
    concept: 'Average after removal of a term',
  }),
  Q({
    topic: 'Time & Work', difficulty: 'hard', question_type: 'quantitative',
    question_text: 'A can do a piece of work in 12 days and B in 18 days. Working together, they will finish it in:',
    options: [{ key: 'A', text: '6.2 days' }, { key: 'B', text: '7.2 days' }, { key: 'C', text: '8 days' }, { key: 'D', text: '9 days' }],
    correct_answer: 'B',
    explanation: 'Combined rate = 1/12 + 1/18 = 5/36 per day → time = 36/5 = 7.2 days.',
    concept: 'Combined work rate',
  }),
  Q({
    topic: 'Geometry', difficulty: 'medium', question_type: 'quantitative',
    question_text: 'The area of a circle with radius 7 cm (take π = 22/7) is:',
    options: [{ key: 'A', text: '144 cm²' }, { key: 'B', text: '154 cm²' }, { key: 'C', text: '164 cm²' }, { key: 'D', text: '176 cm²' }],
    correct_answer: 'B',
    explanation: 'Area = πr² = 22/7 × 49 = 154 cm².',
    concept: 'Area of a circle',
  }),
  Q({
    topic: 'Mensuration', difficulty: 'medium', question_type: 'quantitative',
    question_text: 'The volume of a cube of side 6 cm is:',
    options: [{ key: 'A', text: '126 cm³' }, { key: 'B', text: '196 cm³' }, { key: 'C', text: '216 cm³' }, { key: 'D', text: '256 cm³' }],
    correct_answer: 'C',
    explanation: 'Volume = side³ = 6³ = 216 cm³.',
    concept: 'Volume of a cube',
  }),
  Q({
    topic: 'Algebra', difficulty: 'easy', question_type: 'quantitative',
    question_text: 'If x + 1/x = 4, then x² + 1/x² equals:',
    options: [{ key: 'A', text: '12' }, { key: 'B', text: '14' }, { key: 'C', text: '16' }, { key: 'D', text: '18' }],
    correct_answer: 'B',
    explanation: 'Square both sides: x² + 2 + 1/x² = 16 → x² + 1/x² = 14.',
    concept: 'Algebraic identities involving reciprocals',
  }),
];

export const SSC_ENGLISH_QUESTIONS = [
  E({
    topic: 'Synonyms & Antonyms', difficulty: 'easy', question_type: 'comprehension',
    question_text: 'Select the word most similar in meaning to: ABUNDANT',
    options: [{ key: 'A', text: 'Scarce' }, { key: 'B', text: 'Plentiful' }, { key: 'C', text: 'Meagre' }, { key: 'D', text: 'Rare' }],
    correct_answer: 'B',
    explanation: 'Abundant means existing in large quantities — plentiful. The other three are antonyms.',
    concept: 'Vocabulary — synonyms',
  }),
  E({
    topic: 'One-Word Substitution', difficulty: 'medium', question_type: 'comprehension',
    question_text: 'One-word substitution for: a person who loves mankind',
    options: [{ key: 'A', text: 'Misanthrope' }, { key: 'B', text: 'Philanthropist' }, { key: 'C', text: 'Egoist' }, { key: 'D', text: 'Recluse' }],
    correct_answer: 'B',
    explanation: 'A philanthropist wishes to promote the welfare of others. A misanthrope hates mankind.',
    concept: 'One-word substitutions',
  }),
  E({
    topic: 'Error Spotting', difficulty: 'medium', question_type: 'comprehension',
    question_text: 'Identify the part with an error: "He (A) / do not (B) / like coffee (C) / in the evening (D)."',
    options: [{ key: 'A', text: 'A' }, { key: 'B', text: 'B' }, { key: 'C', text: 'C' }, { key: 'D', text: 'D' }],
    correct_answer: 'B',
    explanation: 'With third-person singular subjects, "do not" becomes "does not".',
    concept: 'Subject–verb agreement',
  }),
  E({
    topic: 'Idioms & Phrases', difficulty: 'easy', question_type: 'comprehension',
    question_text: 'What does the idiom "to let the cat out of the bag" mean?',
    options: [
      { key: 'A', text: 'To free an animal' },
      { key: 'B', text: 'To reveal a secret' },
      { key: 'C', text: 'To create confusion deliberately' },
      { key: 'D', text: 'To avoid responsibility' },
    ],
    correct_answer: 'B',
    explanation: 'The idiom means to disclose something that was meant to be kept secret.',
    concept: 'Common English idioms',
  }),
  E({
    topic: 'Fill in the Blanks', difficulty: 'easy', question_type: 'comprehension',
    question_text: 'She has been working in this company ____ 2019.',
    options: [{ key: 'A', text: 'for' }, { key: 'B', text: 'since' }, { key: 'C', text: 'from' }, { key: 'D', text: 'by' }],
    correct_answer: 'B',
    explanation: '"Since" is used with a point in time (2019); "for" is used with a duration.',
    concept: 'Prepositions of time — since vs for',
  }),
  E({
    topic: 'Spelling', difficulty: 'easy', question_type: 'comprehension',
    question_text: 'Select the correctly spelt word:',
    options: [{ key: 'A', text: 'Acommodation' }, { key: 'B', text: 'Accomodation' }, { key: 'C', text: 'Accommodation' }, { key: 'D', text: 'Acomodation' }],
    correct_answer: 'C',
    explanation: '"Accommodation" has double c and double m.',
    concept: 'Commonly misspelt words',
  }),
  E({
    topic: 'Sentence Improvement', difficulty: 'medium', question_type: 'comprehension',
    question_text: 'Choose the best replacement: "I would rather to stay at home than go out today."',
    options: [
      { key: 'A', text: 'I would rather stay at home than go out today.' },
      { key: 'B', text: 'I would rather staying at home than going out today.' },
      { key: 'C', text: 'I had rather to stay at home than to go out today.' },
      { key: 'D', text: 'No improvement required' },
    ],
    correct_answer: 'A',
    explanation: '"Would rather" is followed by the bare infinitive without "to".',
    concept: 'Sentence improvement — fixed expressions',
  }),
  E({
    topic: 'Reading Comprehension', difficulty: 'medium', question_type: 'comprehension',
    passage: 'Public libraries do more than lend books. They provide free access to computers and the internet, quiet spaces for study, and programmes for children and new readers. For many people, especially those who cannot afford subscriptions or private study rooms, the library remains the only place where information and space are freely available.',
    group_id: 'ssc_comp_1', group_index: 1,
    question_text: 'According to the passage, the main point about public libraries is that they:',
    options: [
      { key: 'A', text: 'lend more books than any other institution' },
      { key: 'B', text: 'offer free resources and space beyond just books' },
      { key: 'C', text: 'are mainly used by children and new readers' },
      { key: 'D', text: 'should charge subscriptions to improve services' },
    ],
    correct_answer: 'B',
    explanation: 'The passage stresses free access to computers, study space and programmes — resources beyond book-lending.',
    concept: 'Main idea of a short passage',
  }),
];

export const SSC_T2_EXTRA_QUESTIONS = [
  CK({
    topic: 'Computer Fundamentals', difficulty: 'easy', question_type: 'factual',
    question_text: 'CPU is an abbreviation for:',
    options: [{ key: 'A', text: 'Central Processing Unit' }, { key: 'B', text: 'Computer Personal Unit' }, { key: 'C', text: 'Central Peripheral Unit' }, { key: 'D', text: 'Control Program Utility' }],
    correct_answer: 'A',
    explanation: 'The Central Processing Unit is the primary component that executes program instructions.',
    concept: 'Basic computer terminology',
  }),
  CK({
    topic: 'Hardware', difficulty: 'easy', question_type: 'factual',
    question_text: 'Which of the following is a volatile memory?',
    options: [{ key: 'A', text: 'ROM' }, { key: 'B', text: 'Hard disk' }, { key: 'C', text: 'RAM' }, { key: 'D', text: 'DVD' }],
    correct_answer: 'C',
    explanation: 'RAM loses its contents when power is switched off; ROM and storage devices retain data.',
    concept: 'Volatile vs non-volatile memory',
  }),
  CK({
    topic: 'Networking', difficulty: 'medium', question_type: 'factual',
    question_text: 'What does LAN stand for?',
    options: [{ key: 'A', text: 'Large Area Network' }, { key: 'B', text: 'Local Area Network' }, { key: 'C', text: 'Long Access Node' }, { key: 'D', text: 'Linked Array Network' }],
    correct_answer: 'B',
    explanation: 'A Local Area Network connects computers within a limited area such as a building or campus.',
    concept: 'Network types — LAN, MAN, WAN',
  }),
  CK({
    topic: 'Internet & Security', difficulty: 'medium', question_type: 'factual',
    question_text: 'Phishing is best described as:',
    options: [
      { key: 'A', text: 'A technique to speed up downloads' },
      { key: 'B', text: 'Fraudulently acquiring sensitive information by posing as a trustworthy entity' },
      { key: 'C', text: 'Compressing files for email' },
      { key: 'D', text: 'A hardware diagnostic test' },
    ],
    correct_answer: 'B',
    explanation: 'Phishing uses fake emails or websites to trick users into revealing passwords, card numbers, etc.',
    concept: 'Cybersecurity threats',
  }),
  CK({
    topic: 'Software', difficulty: 'easy', question_type: 'factual',
    question_text: 'An example of system software is:',
    options: [{ key: 'A', text: 'Web browser' }, { key: 'B', text: 'Operating system' }, { key: 'C', text: 'Word processor' }, { key: 'D', text: 'Media player' }],
    correct_answer: 'B',
    explanation: 'The operating system manages hardware and provides a platform for application software.',
    concept: 'System vs application software',
  }),
  ST({
    topic: 'Measures of Central Tendency', difficulty: 'easy', question_type: 'quantitative',
    question_text: 'The median of the data set 3, 5, 7, 9, 11 is:',
    options: [{ key: 'A', text: '5' }, { key: 'B', text: '7' }, { key: 'C', text: '9' }, { key: 'D', text: '8' }],
    correct_answer: 'B',
    explanation: 'With five ordered values, the median is the third value: 7.',
    concept: 'Median of ungrouped data',
  }),
  ST({
    topic: 'Measures of Dispersion', difficulty: 'medium', question_type: 'quantitative',
    question_text: 'The range of the data 12, 18, 4, 22, 9 is:',
    options: [{ key: 'A', text: '9' }, { key: 'B', text: '13' }, { key: 'C', text: '18' }, { key: 'D', text: '22' }],
    correct_answer: 'C',
    explanation: 'Range = maximum − minimum = 22 − 4 = 18.',
    concept: 'Range as a measure of dispersion',
  }),
];

export const ALL_SSC_SEED_QUESTIONS = [
  ...SSC_REASONING_QUESTIONS,
  ...SSC_AWARENESS_QUESTIONS,
  ...SSC_QUANT_QUESTIONS,
  ...SSC_ENGLISH_QUESTIONS,
  ...SSC_T2_EXTRA_QUESTIONS,
];
export default ALL_SSC_SEED_QUESTIONS;
