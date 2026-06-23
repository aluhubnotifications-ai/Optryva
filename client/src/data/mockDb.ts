import type {
  Application,
  AppNotification,
  CompanyFollow,
  HousingRequest,
  JobListing,
  Message,
  Payment,
  Profile,
  Rating,
  RelocationGuide,
  Resource,
  SkillBooking,
  StudentSkill,
} from '@/types'

// ----------------------------------------------------------------------------
// In-memory mock database. This is the single swap-seam for Phase B: the API
// layer (src/data/api/*) reads/writes these arrays today; in Phase B the same
// API functions hit real HTTP endpoints instead.
// ----------------------------------------------------------------------------

const now = Date.now()
const days = (n: number) => new Date(now - n * 86400000).toISOString()
const inDays = (n: number) => new Date(now + n * 86400000).toISOString()

// Hardcoded profiles removed — students, companies, and schools now come from the
// Supabase-backed server via profilesApi (see lib/api.ts). Empty array kept so any
// remaining mock helpers that reference db.profiles stay safe.
export const profiles: Profile[] = []

// Hardcoded job listings removed — jobs now come from the Supabase-backed
// server via jobsApi (see lib/api.ts). Kept as an empty array so any
// remaining mock helpers that reference db.jobs stay safe.
export const jobs: JobListing[] = []

export const applications: Application[] = [
  {
    id: 'a1',
    student_id: 'u_student',
    job_id: 'j1',
    status: 'shortlisted',
    cover_note:
      'I have shipped React + TypeScript dashboards in production and would love to bring that to Nimbus.',
    documents: [
      { kind: 'cv', name: 'Amara_Okeke_CV.pdf', url: '#', mime: 'application/pdf', size: 234000 },
      { kind: 'cover', name: 'Cover_Letter.pdf', url: '#', mime: 'application/pdf', size: 88000 },
    ],
    full_name: 'Amara Okeke',
    email: 'amara@student.dev',
    phone: '+1 555 0142',
    school: 'University of Cape Town',
    year: 3,
    linkedin: 'https://linkedin.com/in/amara',
    created_at: days(5),
    timeline: [
      { status: 'applied', at: days(5) },
      { status: 'reviewed', at: days(4) },
      { status: 'shortlisted', at: days(2) },
    ],
  },
  {
    id: 'a2',
    student_id: 'u_student',
    job_id: 'j4',
    status: 'pending',
    cover_note: 'Design is my craft and Orbit serves the merchants I care about.',
    documents: [
      { kind: 'cv', name: 'Amara_Okeke_CV.pdf', url: '#', mime: 'application/pdf', size: 234000 },
      { kind: 'portfolio', name: 'Portfolio.pdf', url: '#', mime: 'application/pdf', size: 1200000 },
    ],
    full_name: 'Amara Okeke',
    email: 'amara@student.dev',
    school: 'University of Cape Town',
    year: 3,
    created_at: days(1),
    timeline: [{ status: 'applied', at: days(1) }],
  },
  {
    id: 'a3',
    student_id: 'u_student2',
    job_id: 'j1',
    status: 'reviewed',
    cover_note: 'Strong data + frontend hybrid skills.',
    documents: [{ kind: 'cv', name: 'Diego_CV.pdf', url: '#', mime: 'application/pdf', size: 200000 }],
    full_name: 'Diego Martins',
    email: 'diego@student.dev',
    school: 'Universidade de São Paulo',
    year: 2,
    created_at: days(3),
    timeline: [
      { status: 'applied', at: days(3) },
      { status: 'reviewed', at: days(2) },
    ],
  },
  {
    id: 'a4',
    student_id: 'u_student3',
    job_id: 'j1',
    status: 'pending',
    documents: [{ kind: 'cv', name: 'Priya_CV.pdf', url: '#', mime: 'application/pdf', size: 210000 }],
    full_name: 'Priya Sharma',
    email: 'priya@student.dev',
    school: 'National University of Singapore',
    year: 4,
    created_at: days(1),
    timeline: [{ status: 'applied', at: days(1) }],
  },
]

export const messages: Message[] = [
  {
    id: 'm1',
    thread_id: 'a1',
    scope: 'application',
    sender_id: 'c_nimbus',
    kind: 'text',
    body: 'Hi Amara! We loved your application. Are you available for a quick chat this week?',
    reactions: {},
    read: true,
    created_at: days(2),
  },
  {
    id: 'm2',
    thread_id: 'a1',
    scope: 'application',
    sender_id: 'u_student',
    kind: 'text',
    body: 'Thank you so much! Yes, I’m free Thursday or Friday afternoon (SAST).',
    reactions: { '🎉': ['c_nimbus'] },
    read: true,
    created_at: days(2),
  },
  {
    id: 'm3',
    thread_id: 'u_student__u_student3',
    scope: 'dm',
    sender_id: 'u_student3',
    kind: 'text',
    body: 'Hey Amara — saw you offer React tutoring. Could you help me with hooks?',
    reactions: {},
    read: false,
    created_at: days(1),
  },
]

export const studentSkills: StudentSkill[] = [
  {
    id: 'sk1',
    owner_id: 'u_student',
    skill: 'React & TypeScript',
    level: 'advanced',
    years: 3,
    portfolio_url: 'https://amara.dev',
    verified: true,
    sessions: 14,
    rating: 4.9,
    rating_count: 11,
    blurb: 'I’ll get you from confused to confident with hooks, state, and clean components.',
  },
  {
    id: 'sk2',
    owner_id: 'u_student3',
    skill: 'UI/UX Design in Figma',
    level: 'expert',
    years: 4,
    verified: true,
    sessions: 22,
    rating: 5.0,
    rating_count: 19,
    blurb: 'Portfolio reviews, design systems, and prototyping that gets you hired.',
  },
  {
    id: 'sk3',
    owner_id: 'u_student2',
    skill: 'Python for Data Science',
    level: 'intermediate',
    years: 2,
    verified: false,
    sessions: 6,
    rating: 4.7,
    rating_count: 5,
    blurb: 'pandas, visualization, and your first ML model — explained simply.',
  },
]

export const skillBookings: SkillBooking[] = []

export const resources: Resource[] = [
  {
    id: 'r1',
    owner_id: 'u_student3',
    title: 'The Ultimate Tech Resume Template',
    author: 'Priya Sharma',
    type: 'Template',
    price: 9,
    currency: 'USD',
    icon: '📄',
    file_name: 'tech-resume.docx',
    file_type: 'docx',
    file_size: 45000,
    sales: 128,
    created_at: days(14),
  },
  {
    id: 'r2',
    owner_id: 'u_student2',
    title: 'Data Structures & Algorithms — Full Notes',
    author: 'Diego Martins',
    type: 'Notes',
    price: 15,
    currency: 'USD',
    icon: '🧠',
    file_name: 'dsa-notes.pdf',
    file_type: 'pdf',
    file_size: 3200000,
    sales: 87,
    created_at: days(20),
  },
  {
    id: 'r3',
    owner_id: 'u_student',
    title: 'System Design Interview Case Study',
    author: 'Amara Okeke',
    type: 'Case Study',
    price: 0,
    currency: 'USD',
    icon: '🏗️',
    file_name: 'system-design.pdf',
    file_type: 'pdf',
    file_size: 1800000,
    sales: 203,
    created_at: days(10),
  },
]

export const housing: HousingRequest[] = [
  {
    id: 'h1',
    poster_id: 'u_student2',
    title: 'Looking for a roommate near downtown for summer internship',
    description:
      'Starting a 3-month internship and need short-term housing. Clean, quiet, and easy-going.',
    area: 'Downtown',
    city: 'Berlin, Germany',
    people: 1,
    dates: 'Jun – Aug',
    urgent: true,
    status: 'active',
    created_at: days(2),
  },
  {
    id: 'h2',
    poster_id: 'u_student3',
    title: 'Sublet available — furnished studio',
    description: 'Furnished studio available for the autumn semester. 10 min from campus.',
    area: 'University District',
    city: 'Singapore',
    people: 2,
    dates: 'Sep – Dec',
    urgent: false,
    status: 'active',
    created_at: days(6),
  },
]

export const relocationGuides: RelocationGuide[] = [
  {
    id: 'g1',
    city: 'Berlin',
    country: 'Germany',
    icon: '🇩🇪',
    title: 'Settling into Berlin',
    items: [
      { label: 'Groceries', detail: 'Aldi, Lidl, and REWE are affordable; Sundays most shops are closed.' },
      { label: 'Transit', detail: 'Get a monthly BVG pass — U-Bahn + trams cover the whole city.' },
      { label: 'SIM card', detail: 'Aldi Talk and o2 offer cheap prepaid data plans.' },
      { label: 'Basics', detail: '“Hallo / Danke / Tschüss” go a long way. Carry some cash.' },
    ],
  },
  {
    id: 'g2',
    city: 'Singapore',
    country: 'Singapore',
    icon: '🇸🇬',
    title: 'Landing in Singapore',
    items: [
      { label: 'Food', detail: 'Hawker centres are cheap, delicious, and everywhere.' },
      { label: 'Transit', detail: 'Tap any contactless card on the MRT — fast and spotless.' },
      { label: 'SIM card', detail: 'Singtel/StarHub tourist SIMs at the airport.' },
      { label: 'Costs', detail: 'Housing is the big one — look at co-living for short stays.' },
    ],
  },
]

export const follows: CompanyFollow[] = [
  { student_id: 'u_student', company_id: 'c_nimbus', email_notifications: true },
]

export const ratings: Rating[] = [
  {
    id: 'rt1',
    rater_id: 'u_student2',
    ref_type: 'skill',
    ref_id: 'sk1',
    stars: 5,
    comment: 'Amara made hooks finally click. Highly recommend!',
    created_at: days(7),
  },
  {
    id: 'rt2',
    rater_id: 'u_student',
    ref_type: 'company',
    ref_id: 'c_nimbus',
    stars: 5,
    comment: 'Great async culture and real mentorship.',
    created_at: days(9),
  },
]

export const notifications: AppNotification[] = [
  {
    id: 'n1',
    user_id: 'u_student',
    type: 'status_change',
    title: 'You’ve been shortlisted! 🎉',
    body: 'Nimbus Labs moved your application for Frontend Engineer Intern to Shortlisted.',
    read: false,
    ref_id: 'a1',
    created_at: days(2),
  },
  {
    id: 'n2',
    user_id: 'u_student',
    type: 'dm',
    title: 'New message from Priya Sharma',
    body: 'Hey Amara — saw you offer React tutoring…',
    read: false,
    ref_id: 'u_student__u_student3',
    created_at: days(1),
  },
  {
    id: 'n3',
    user_id: 'u_student',
    type: 'followed_company_listing',
    title: 'Nimbus Labs posted a new role',
    body: 'Developer Relations Intern — Remote (Global)',
    read: true,
    ref_id: 'j5',
    created_at: days(7),
  },
]

export const payments: Payment[] = [
  {
    id: 'p1',
    user_id: 'u_student2',
    amount: 4,
    currency: 'USD',
    status: 'paid',
    label: 'Optryva Pro — Monthly',
    ref_type: 'subscription',
    created_at: days(5),
  },
]

// Current signed-in user id for the mock session (defaults to the student demo).
export const session = { currentUserId: 'u_student' as string | null }
