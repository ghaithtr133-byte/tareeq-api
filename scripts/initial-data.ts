import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { z } from 'zod'

import { hashPassword, verifyPassword } from '../src/auth/crypto.js'
import { PrismaContentRepository } from '../src/content/prisma-repository.js'
import { contentCreateSchemas } from '../src/content/schemas.js'
import { ContentService } from '../src/content/service.js'
import type {
  ContentEntity,
  ContentResource,
  ContentWriteData,
  PublicationStatus,
} from '../src/content/types.js'
import { disconnectPrisma, getPrisma } from '../src/database/client.js'
import { AdminRole } from '../src/generated/prisma/enums.js'
import { initialAccountsSchema } from './initial-account-validation.js'

const manifestPath = resolve('reports/initial-seed-manifest.json')
const resources: ContentResource[] = [
  'countries',
  'universities',
  'scholarships',
  'services',
  'articles',
]

const recordTypes: Record<ContentResource, string> = {
  countries: 'Country',
  universities: 'University',
  scholarships: 'Scholarship',
  services: 'Service',
  articles: 'Article',
}

type ManifestOutcome = 'CREATED' | 'ALREADY_EXISTS'

type ManifestEntry = {
  recordType: string
  resource?: ContentResource
  id: string
  slug?: string
  role?: 'ADMIN' | 'SUPER_ADMIN'
  status?: PublicationStatus
  outcome: ManifestOutcome
  createdDuringTask: boolean
  relationships: Record<string, string>
  sourceUrl: string | null
}

type SeedManifest = {
  schemaVersion: 1
  task: 'Backend — Initial Data Seeding & Admin Accounts'
  generatedAtUtc: string
  database: { identifier: 'configured Neon PostgreSQL database' }
  accounts: ManifestEntry[]
  content: ManifestEntry[]
}

const newManifest = (): SeedManifest => ({
  schemaVersion: 1,
  task: 'Backend — Initial Data Seeding & Admin Accounts',
  generatedAtUtc: new Date().toISOString(),
  database: { identifier: 'configured Neon PostgreSQL database' },
  accounts: [],
  content: [],
})

const loadManifest = async () => {
  try {
    const value = JSON.parse(await readFile(manifestPath, 'utf8')) as Partial<SeedManifest>
    if (
      value.schemaVersion !== 1 ||
      !Array.isArray(value.accounts) ||
      !Array.isArray(value.content)
    ) {
      throw new Error('invalid manifest structure')
    }
    return value as SeedManifest
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return newManifest()
    }
    throw new Error(
      'The existing seed manifest is invalid. Preserve it and repair it before any seed write.',
      { cause: error },
    )
  }
}

const saveManifest = async (manifest: SeedManifest) => {
  manifest.generatedAtUtc = new Date().toISOString()
  await mkdir(dirname(manifestPath), { recursive: true })
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

const preserveCreatedFlag = (
  entries: ManifestEntry[],
  entry: ManifestEntry,
) => {
  const prior = entries.find(
    (candidate) =>
      candidate.recordType === entry.recordType && candidate.id === entry.id,
  )
  return prior?.createdDuringTask === true || entry.createdDuringTask
}

const upsertManifestEntry = async (
  manifest: SeedManifest,
  section: 'accounts' | 'content',
  entry: ManifestEntry,
) => {
  const entries = manifest[section]
  entry.createdDuringTask = preserveCreatedFlag(entries, entry)
  const index = entries.findIndex(
    (candidate) =>
      candidate.recordType === entry.recordType &&
      (entry.slug
        ? candidate.slug === entry.slug
        : candidate.role === entry.role),
  )
  if (index >= 0) entries[index] = entry
  else entries.push(entry)
  await saveManifest(manifest)
}

const countries = [
  {
    slug: 'romania',
    nameAr: 'رومانيا',
    nameEn: 'Romania',
    introductionAr:
      'وجهة دراسية أوروبية تضم جامعات وبرامج متنوعة. ينبغي للطالب مراجعة لغة البرنامج ومتطلبات القبول والإقامة من المصادر الرسمية قبل التقديم.',
    detailsAr:
      'تختلف إجراءات القبول حسب الجامعة والمرحلة الدراسية. ابدأ باختيار البرنامج، ثم تحقق من الوثائق والترجمة والاعتراف الأكاديمي والمواعيد عبر موقع الجامعة والجهات الرومانية الرسمية.',
    featured: true,
    displayOrder: 1,
    status: 'PUBLISHED',
    seoTitleAr: 'الدراسة في رومانيا',
    seoDescriptionAr: 'معلومات تمهيدية موثوقة تساعدك على بدء البحث عن الدراسة والجامعات في رومانيا.',
  },
  {
    slug: 'turkey',
    nameAr: 'تركيا',
    nameEn: 'Türkiye',
    introductionAr:
      'وجهة قريبة جغرافياً وثقافياً وتضم مؤسسات تعليم عالٍ وبرامج بلغات مختلفة. يجب الرجوع إلى الجامعة مباشرة للتحقق من شروط كل برنامج.',
    detailsAr:
      'قارن بين لغة التدريس، متطلبات القبول، الاعتراف، ومكان الحرم الجامعي. لا تعتمد على معلومات الرسوم أو المواعيد إلا بعد تأكيدها من الموقع الرسمي للجامعة.',
    featured: true,
    displayOrder: 2,
    status: 'PUBLISHED',
    seoTitleAr: 'الدراسة في تركيا',
    seoDescriptionAr: 'نقطة بداية للبحث عن الجامعات وخيارات الدراسة في تركيا من مصادرها الرسمية.',
  },
  {
    slug: 'poland',
    nameAr: 'بولندا',
    nameEn: 'Poland',
    introductionAr:
      'وجهة أوروبية تضم جامعات عريقة وبرامج دراسية متعددة، بما فيها برامج بالإنجليزية. تختلف المتطلبات والمواعيد بين الجامعات والبرامج.',
    detailsAr:
      'تحقق من أهلية الشهادة، لغة البرنامج، ملف القبول، ومتطلبات الإقامة من الجهات الرسمية. راجع صفحة البرنامج المختار قبل اتخاذ أي قرار مالي.',
    featured: true,
    displayOrder: 3,
    status: 'PUBLISHED',
    seoTitleAr: 'الدراسة في بولندا',
    seoDescriptionAr: 'مدخل عملي للبحث عن الجامعات والدراسة في بولندا والتحقق من المتطلبات الرسمية.',
  },
] as const

const universitySeeds = [
  {
    countrySlug: 'romania',
    input: {
      slug: 'university-of-bucharest',
      nameAr: 'جامعة بوخارست',
      nameEn: 'University of Bucharest',
      officialName: 'University of Bucharest',
      cityAr: 'بوخارست',
      cityEn: 'Bucharest',
      overviewAr:
        'جامعة في العاصمة بوخارست. يعرض موقعها الرسمي البنية الأكاديمية وخدمات الطلبة الدوليين والموارد اللازمة للبحث عن البرامج.',
      officialWebsite: 'https://unibuc.ro/?lang=en',
      featured: true,
      status: 'PUBLISHED',
      seoTitleAr: 'جامعة بوخارست',
      seoDescriptionAr: 'تعرف إلى جامعة بوخارست وابدأ التحقق من البرامج والمتطلبات عبر الموقع الرسمي.',
    },
  },
  {
    countrySlug: 'romania',
    input: {
      slug: 'babes-bolyai-university',
      nameAr: 'جامعة بابيش-بويّاي',
      nameEn: 'Babeș-Bolyai University',
      officialName: 'Babeș-Bolyai University',
      cityAr: 'كلوج-نابوكا',
      cityEn: 'Cluj-Napoca',
      overviewAr:
        'جامعة مقرها كلوج-نابوكا وتعرض عبر موقعها الرسمي كليات وبرامج دراسية بعدة لغات. يجب التحقق من صفحة البرنامج المحدد عند التقديم.',
      officialWebsite: 'https://www.ubbcluj.ro/en/',
      featured: false,
      status: 'PUBLISHED',
      seoTitleAr: 'جامعة بابيش-بويّاي',
      seoDescriptionAr: 'معلومات تعريفية وروابط رسمية لجامعة بابيش-بويّاي في كلوج-نابوكا.',
    },
  },
  {
    countrySlug: 'turkey',
    input: {
      slug: 'bogazici-university',
      nameAr: 'جامعة بوغازيتشي',
      nameEn: 'Boğaziçi University',
      officialName: 'Boğaziçi University',
      cityAr: 'إسطنبول',
      cityEn: 'Istanbul',
      overviewAr:
        'جامعة مقرها إسطنبول وتوفر معلومات رسمية عن كلياتها وبرامجها وخدمات الطلبة الدوليين. راجع كتالوج البرنامج وصفحة القبول مباشرة.',
      officialWebsite: 'https://bogazici.edu.tr/en',
      featured: true,
      status: 'PUBLISHED',
      seoTitleAr: 'جامعة بوغازيتشي',
      seoDescriptionAr: 'تعرف إلى جامعة بوغازيتشي في إسطنبول عبر معلوماتها وموقعها الرسمي.',
    },
  },
  {
    countrySlug: 'turkey',
    input: {
      slug: 'middle-east-technical-university',
      nameAr: 'جامعة الشرق الأوسط التقنية',
      nameEn: 'Middle East Technical University',
      officialName: 'Middle East Technical University',
      cityAr: 'أنقرة',
      cityEn: 'Ankara',
      overviewAr:
        'جامعة مقرها أنقرة وتعرض عبر موقعها الرسمي برامج البكالوريوس والدراسات العليا وموارد الطلبة المحتملين. تحقق من متطلبات القسم والبرنامج المختار.',
      officialWebsite: 'https://www.metu.edu.tr/',
      featured: false,
      status: 'PUBLISHED',
      seoTitleAr: 'جامعة الشرق الأوسط التقنية',
      seoDescriptionAr: 'مدخل إلى جامعة الشرق الأوسط التقنية وبرامجها وروابطها الرسمية.',
    },
  },
  {
    countrySlug: 'poland',
    input: {
      slug: 'university-of-warsaw',
      nameAr: 'جامعة وارسو',
      nameEn: 'University of Warsaw',
      officialName: 'University of Warsaw',
      cityAr: 'وارسو',
      cityEn: 'Warsaw',
      overviewAr:
        'جامعة في العاصمة وارسو وتعرض عبر موقعها الرسمي البرامج وخدمات الاستقبال وإجراءات التقديم. تختلف جداول القبول حسب البرنامج.',
      officialWebsite: 'https://en.uw.edu.pl/',
      featured: true,
      status: 'PUBLISHED',
      seoTitleAr: 'جامعة وارسو',
      seoDescriptionAr: 'تعرف إلى جامعة وارسو وابدأ البحث عن البرامج وشروط القبول من المصدر الرسمي.',
    },
  },
  {
    countrySlug: 'poland',
    input: {
      slug: 'jagiellonian-university',
      nameAr: 'جامعة ياغيلونيا',
      nameEn: 'Jagiellonian University',
      officialName: 'Jagiellonian University',
      cityAr: 'كراكوف',
      cityEn: 'Kraków',
      overviewAr:
        'جامعة في كراكوف تعرض عبر بوابتها الرسمية الكليات وبرامج الدراسة وخطوات التقديم. يجب مراجعة صفحة البرنامج للتأكد من اللغة والمواعيد.',
      officialWebsite: 'https://en.uj.edu.pl/en_GB/start',
      featured: false,
      status: 'PUBLISHED',
      seoTitleAr: 'جامعة ياغيلونيا',
      seoDescriptionAr: 'معلومات تعريفية وروابط رسمية لجامعة ياغيلونيا في كراكوف.',
    },
  },
] as const

const scholarshipSeeds = [
  {
    countrySlug: 'romania',
    input: {
      slug: 'romania-government-scholarship-2026',
      titleAr: 'منحة الحكومة الرومانية للطلبة الأجانب 2026',
      titleEn: 'Romanian Government Scholarship for Foreign Citizens 2026',
      studyLevel: 'BACHELOR_MASTER_PHD',
      fundingType: 'GOVERNMENT_FUNDED',
      requirementsAr:
        'استهدفت دورة 2026 مواطني الدول غير الأعضاء في الاتحاد الأوروبي ضمن شروط الاستحقاق والوثائق الواردة في الإعلان الرسمي. لا يُعد هذا الملخص بديلاً عن الشروط الكاملة.',
      descriptionAr:
        'برنامج سنوي تقدمه الحكومة الرومانية عبر وزارة الخارجية. انتهى استقبال طلبات دورة 2026؛ راجع المصدر الرسمي لمعرفة أي دورة لاحقة وتفاصيل التغطية والبرامج المؤهلة.',
      verifiedDeadline: null,
      officialSourceUrl:
        'https://scholarships.studyinromania.gov.ro/scholarship-about',
      applicationStatus: 'CLOSED',
      featured: true,
      status: 'PUBLISHED',
      seoTitleAr: 'منحة الحكومة الرومانية 2026',
      seoDescriptionAr: 'معلومات موثقة عن دورة 2026 المغلقة مع رابط الإعلان الحكومي الرسمي.',
    },
  },
  {
    countrySlug: 'turkey',
    input: {
      slug: 'turkiye-scholarships-2026',
      titleAr: 'المنح التركية 2026',
      titleEn: 'Türkiye Scholarships 2026',
      studyLevel: 'ASSOCIATE_BACHELOR_MASTER_PHD',
      fundingType: 'GOVERNMENT_FUNDED_FULL',
      requirementsAr:
        'كانت دورة 2026 متاحة للطلبة الدوليين وفق معايير البرنامج التنافسية والأكاديمية. تختلف المعايير بحسب المرحلة، ويجب مراجعة صفحة البرنامج الرسمية.',
      descriptionAr:
        'برنامج منح حكومي تنافسي يشمل وفق الإعلان الرسمي دعماً مالياً ورسوم الدراسة والسكن والتأمين الصحي والتسكين الجامعي. انتهت فترة التقديم لدورة 2026.',
      verifiedDeadline: null,
      officialSourceUrl:
        'https://turkiyeburslari.gov.tr/announcements/turkiye-scholarships-2026-applications-121',
      applicationStatus: 'CLOSED',
      featured: true,
      status: 'PUBLISHED',
      seoTitleAr: 'المنح التركية 2026',
      seoDescriptionAr: 'ملخص موثق لدورة المنح التركية 2026 المغلقة ورابط المصدر الرسمي.',
    },
  },
  {
    countrySlug: 'poland',
    input: {
      slug: 'banach-nawa-programme-2026',
      titleAr: 'برنامج باناخ NAWA للماجستير 2026',
      titleEn: 'Banach NAWA Programme 2026',
      studyLevel: 'MASTER',
      fundingType: 'TUITION_AND_STIPEND',
      requirementsAr:
        'استهدفت دورة 2026 مواطني الدول المحددة في الإعلان ممن تنطبق عليهم شروط الدرجة الجامعية واللغة وبقية الوثائق. يجب الرجوع إلى الإعلان واللائحة الرسميين.',
      descriptionAr:
        'برنامج بولندي لبرامج الماجستير بدوام كامل، مع منحة شهرية وإعفاء من الرسوم في الجامعات العامة ومزايا أخرى وفق الإعلان. أُغلق التقديم لدورة 2026.',
      verifiedDeadline: '2026-05-08T15:00:00+02:00',
      officialSourceUrl:
        'https://nawa.gov.pl/en/nawa/news/call-for-applications-banach-nawa-2026',
      applicationStatus: 'CLOSED',
      featured: true,
      status: 'PUBLISHED',
      seoTitleAr: 'برنامج باناخ NAWA 2026',
      seoDescriptionAr: 'معلومات موثقة عن دورة 2026 المغلقة لبرنامج باناخ NAWA للماجستير.',
    },
  },
] as const

const services = [
  {
    slug: 'university-selection-consultation',
    titleAr: 'استشارة اختيار الجامعة والبرنامج',
    summaryAr: 'جلسة مقترحة لتنظيم خيارات الدراسة وفق أهداف الطالب وقيوده.',
    descriptionAr:
      'تصور أولي لخدمة تساعد الطالب على بناء قائمة خيارات وأسئلة للتحقق منها. لا تتضمن ضمان قبول أو ادعاء شراكة مع أي جامعة، وتبقى مسودة حتى اعتمادها تجارياً.',
    displayOrder: 1,
    featured: false,
    status: 'DRAFT',
  },
  {
    slug: 'application-file-review',
    titleAr: 'مراجعة ملف التقديم',
    summaryAr: 'خدمة مقترحة لمراجعة تنظيم الملف مقابل قائمة المتطلبات المعلنة.',
    descriptionAr:
      'تصور أولي لمراجعة اكتمال الوثائق وترتيبها استناداً إلى متطلبات الجهة المستقبلة. لا تشمل إصدار وثائق أو ضمان قبول، وتحتاج اعتماد نطاقها قبل النشر.',
    displayOrder: 2,
    featured: false,
    status: 'DRAFT',
  },
  {
    slug: 'pre-departure-study-guidance',
    titleAr: 'إرشاد ما قبل بدء الدراسة',
    summaryAr: 'خدمة مقترحة لتنظيم خطوات ما قبل السفر والبدء الأكاديمي.',
    descriptionAr:
      'تصور أولي لقائمة تحقق شخصية تشمل متابعة المصادر الرسمية والاستعداد الأكاديمي واللوجستي. لا تمثل استشارة قانونية أو ضماناً للتأشيرة، وتبقى مسودة حتى اعتمادها.',
    displayOrder: 3,
    featured: false,
    status: 'DRAFT',
  },
] as const

const articleSeeds = [
  {
    countrySlug: 'romania',
    universitySlug: 'university-of-bucharest',
    scholarshipSlug: 'romania-government-scholarship-2026',
    input: {
      slug: 'how-to-prepare-university-application',
      titleAr: 'كيف تجهز ملف التقديم الجامعي خطوة بخطوة؟',
      summaryAr: 'دليل تحريري أولي لتنظيم الوثائق والتحقق من متطلبات البرنامج قبل الإرسال.',
      bodyAr: [
        { type: 'paragraph', text: 'ابدأ من صفحة البرنامج الرسمية، وسجل كل متطلب وموعد في قائمة مستقلة قبل تجهيز الملفات.' },
        { type: 'heading2', text: 'الوثائق الأساسية' },
        { type: 'bulleted-list', text: 'الشهادات وكشوف الدرجات، إثبات اللغة، وثيقة الهوية، وأي مستندات خاصة بالبرنامج.' },
        { type: 'heading3', text: 'الترجمة والتصديق' },
        { type: 'numbered-list', text: 'تحقق من اللغة المطلوبة، ثم جهة الترجمة المقبولة، ثم متطلبات التصديق، وأخيراً صيغة الرفع.' },
        { type: 'quote', text: 'اعتمد دائماً النسخة الأحدث من تعليمات الجامعة، لا قائمة قديمة محفوظة لديك.' },
      ],
      featured: false,
      status: 'DRAFT',
    },
  },
  {
    countrySlug: 'turkey',
    universitySlug: 'bogazici-university',
    scholarshipSlug: 'turkiye-scholarships-2026',
    input: {
      slug: 'compare-study-destinations',
      titleAr: 'طريقة عملية لمقارنة وجهات الدراسة',
      summaryAr: 'إطار تحريري أولي للمقارنة بين البرامج بدلاً من الاعتماد على انطباع عام عن البلد.',
      bodyAr: [
        { type: 'heading2', text: 'قارن البرنامج قبل البلد' },
        { type: 'paragraph', text: 'ابدأ بالاعتماد الأكاديمي ولغة التدريس ومحتوى الخطة، ثم أضف السكن والإقامة والتكلفة والبيئة اليومية.' },
        { type: 'bulleted-list', text: 'الاعتراف، لغة الدراسة، متطلبات القبول، التكلفة الموثقة، ومواعيد التقديم.' },
        { type: 'quote', text: 'الخيار الأنسب هو الذي يطابق هدفك وقيودك، لا الخيار الأكثر شهرة فقط.' },
      ],
      featured: false,
      status: 'DRAFT',
    },
  },
  {
    countrySlug: 'poland',
    universitySlug: 'jagiellonian-university',
    scholarshipSlug: 'banach-nawa-programme-2026',
    input: {
      slug: 'how-to-read-scholarship-requirements',
      titleAr: 'كيف تقرأ إعلان المنحة بأمان؟',
      summaryAr: 'دليل تحريري أولي للتحقق من الأهلية والتمويل والمواعيد من المصدر الرسمي.',
      bodyAr: [
        { type: 'heading2', text: 'ابدأ بالأهلية' },
        { type: 'numbered-list', text: 'تحقق من الجنسية، المرحلة، تاريخ التخرج، اللغة، ثم قائمة الوثائق والمواعيد.' },
        { type: 'heading3', text: 'افهم التمويل بدقة' },
        { type: 'paragraph', text: 'فرّق بين الإعفاء من الرسوم، المخصص الشهري، السفر، السكن، والتأمين؛ فقد لا يجمع البرنامج بينها جميعاً.' },
        { type: 'quote', text: 'وجود اسم المنحة في موقع غير رسمي لا يثبت أن التقديم مفتوح.' },
      ],
      featured: false,
      status: 'DRAFT',
    },
  },
] as const

const normalizedComparable = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(normalizedComparable)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalizedComparable(child)]),
    )
  }
  return value
}

const matchesInput = (existing: ContentEntity, input: ContentWriteData) =>
  Object.entries(input).every(([key, expected]) => {
    const actual = existing[key]
    if (key === 'verifiedDeadline' && expected !== null) {
      return (
        new Date(String(actual)).getTime() === new Date(String(expected)).getTime()
      )
    }
    return (
      JSON.stringify(normalizedComparable(actual)) ===
      JSON.stringify(normalizedComparable(expected))
    )
  })

const toManifestEntry = (
  resource: ContentResource,
  record: ContentEntity,
  outcome: ManifestOutcome,
  sourceUrl: string | null,
): ManifestEntry => {
  const relationships: Record<string, string> = {}
  for (const key of ['countryId', 'universityId', 'scholarshipId']) {
    if (typeof record[key] === 'string') relationships[key] = record[key]
  }
  return {
    recordType: recordTypes[resource],
    resource,
    id: record.id,
    slug: record.slug,
    status: record.status,
    outcome,
    createdDuringTask: outcome === 'CREATED',
    relationships,
    sourceUrl,
  }
}

const seedOne = async (
  service: ContentService,
  repository: PrismaContentRepository,
  manifest: SeedManifest,
  resource: ContentResource,
  rawInput: Record<string, unknown>,
) => {
  const input = contentCreateSchemas[resource].parse(rawInput) as ContentWriteData
  const slug = String(input.slug)
  const existing = await repository.findBySlug(resource, slug, false)
  const sourceUrl =
    typeof input.officialSourceUrl === 'string'
      ? input.officialSourceUrl
      : typeof input.officialWebsite === 'string'
        ? input.officialWebsite
        : null

  if (existing) {
    if (!matchesInput(existing, input)) {
      throw new Error(
        `BLOCKED — CONFLICTING ${recordTypes[resource].toUpperCase()} SEED: ${slug}`,
      )
    }
    await upsertManifestEntry(
      manifest,
      'content',
      toManifestEntry(resource, existing, 'ALREADY_EXISTS', sourceUrl),
    )
    console.log(`${recordTypes[resource]} ${slug}: ALREADY_EXISTS`)
    return existing
  }

  const created = await service.create(resource, input)
  await upsertManifestEntry(
    manifest,
    'content',
    toManifestEntry(resource, created, 'CREATED', sourceUrl),
  )
  console.log(`${recordTypes[resource]} ${slug}: CREATED`)
  return created
}

const inspect = async () => {
  const prisma = getPrisma()
  const groupByStatus = (resource: ContentResource) => {
    const args = {
      by: ['status'] as ['status'],
      _count: { _all: true as const },
    }
    switch (resource) {
      case 'countries': return prisma.country.groupBy(args)
      case 'universities': return prisma.university.groupBy(args)
      case 'scholarships': return prisma.scholarship.groupBy(args)
      case 'services': return prisma.service.groupBy(args)
      case 'articles': return prisma.article.groupBy(args)
    }
  }
  const findSeedSlugs = (resource: ContentResource, slugs: string[]) => {
    const args = { where: { slug: { in: slugs } }, select: { slug: true } }
    switch (resource) {
      case 'countries': return prisma.country.findMany(args)
      case 'universities': return prisma.university.findMany(args)
      case 'scholarships': return prisma.scholarship.findMany(args)
      case 'services': return prisma.service.findMany(args)
      case 'articles': return prisma.article.findMany(args)
    }
  }
  const [adminGroups, sessionCount, ...contentGroups] = await Promise.all([
    prisma.adminUser.groupBy({
      by: ['role', 'isActive'],
      _count: { _all: true },
    }),
    prisma.refreshSession.count(),
    ...resources.map(groupByStatus),
  ])

  const seedSlugs: Record<ContentResource, string[]> = {
    countries: countries.map(({ slug }) => slug),
    universities: universitySeeds.map(({ input }) => input.slug),
    scholarships: scholarshipSeeds.map(({ input }) => input.slug),
    services: services.map(({ slug }) => slug),
    articles: articleSeeds.map(({ input }) => input.slug),
  }
  const seedState: Record<string, { existing: number; missing: number }> = {}
  for (const resource of resources) {
    const found = await findSeedSlugs(resource, seedSlugs[resource])
    seedState[resource] = {
      existing: found.length,
      missing: seedSlugs[resource].length - found.length,
    }
  }

  const credentialVariables = [
    'INITIAL_ADMIN_NAME',
    'INITIAL_ADMIN_EMAIL',
    'INITIAL_ADMIN_PASSWORD',
    'INITIAL_SUPER_ADMIN_NAME',
    'INITIAL_SUPER_ADMIN_EMAIL',
    'INITIAL_SUPER_ADMIN_PASSWORD',
  ]
  console.log(
    JSON.stringify(
      {
        mode: 'READ_ONLY',
        administrators: adminGroups,
        refreshSessions: sessionCount,
        content: Object.fromEntries(
          resources.map((resource, index) => [resource, contentGroups[index]]),
        ),
        seedTargets: seedState,
        credentialConfiguration: Object.fromEntries(
          credentialVariables.map((name) => [
            name,
            process.env[name]?.trim() ? 'CONFIGURED' : 'MISSING',
          ]),
        ),
      },
      null,
      2,
    ),
  )
}

const provisionAccounts = async () => {
  const requiredVariables = [
    'INITIAL_ADMIN_NAME',
    'INITIAL_ADMIN_EMAIL',
    'INITIAL_ADMIN_PASSWORD',
    'INITIAL_SUPER_ADMIN_NAME',
    'INITIAL_SUPER_ADMIN_EMAIL',
    'INITIAL_SUPER_ADMIN_PASSWORD',
  ]
  const missing = requiredVariables.filter(
    (name) => !process.env[name]?.trim(),
  )
  if (missing.length > 0) {
    throw new Error(
      `BLOCKED — MISSING_PREREQUISITE: ${missing.join(', ')}`,
    )
  }

  const input = initialAccountsSchema.parse(process.env)
  const targets = [
    {
      name: input.INITIAL_ADMIN_NAME,
      email: input.INITIAL_ADMIN_EMAIL,
      password: input.INITIAL_ADMIN_PASSWORD,
      role: AdminRole.ADMIN,
    },
    {
      name: input.INITIAL_SUPER_ADMIN_NAME,
      email: input.INITIAL_SUPER_ADMIN_EMAIL,
      password: input.INITIAL_SUPER_ADMIN_PASSWORD,
      role: AdminRole.SUPER_ADMIN,
    },
  ] as const

  const prisma = getPrisma()
  const existingUsers = await prisma.adminUser.findMany()
  const targetEmails = new Set(targets.map(({ email }) => email.toLowerCase()))
  if (
    existingUsers.some(({ email }) => !targetEmails.has(email.toLowerCase()))
  ) {
    throw new Error(
      'BLOCKED — Existing administrator records fall outside the two requested permanent accounts.',
    )
  }

  const existingByRole = new Map<string, (typeof existingUsers)[number]>()
  for (const target of targets) {
    const existing = existingUsers.find(
      ({ email }) => email.toLowerCase() === target.email.toLowerCase(),
    )
    if (!existing) continue
    const passwordMatches = await verifyPassword(
      existing.passwordHash,
      target.password,
    )
    if (
      existing.role !== target.role ||
      !existing.isActive ||
      existing.name !== target.name ||
      !passwordMatches
    ) {
      throw new Error(
        `BLOCKED — Existing ${target.role} account conflicts with the requested role, state, name, or credentials.`,
      )
    }
    existingByRole.set(target.role, existing)
  }

  const manifest = await loadManifest()
  for (const target of targets) {
    let account = existingByRole.get(target.role)
    let outcome: ManifestOutcome = 'ALREADY_EXISTS'
    if (!account) {
      account = await prisma.adminUser.create({
        data: {
          name: target.name,
          email: target.email,
          passwordHash: await hashPassword(target.password),
          role: target.role,
          isActive: true,
        },
      })
      outcome = 'CREATED'
    }
    await upsertManifestEntry(manifest, 'accounts', {
      recordType: 'AdminUser',
      id: account.id,
      role: target.role,
      outcome,
      createdDuringTask: outcome === 'CREATED',
      relationships: {},
      sourceUrl: null,
    })
    console.log(`${target.role}: ${outcome}`)
  }

  const finalCounts = await prisma.adminUser.groupBy({
    by: ['role'],
    _count: { _all: true },
  })
  const countFor = (role: AdminRole) =>
    finalCounts.find((item) => item.role === role)?._count._all ?? 0
  if (
    countFor(AdminRole.ADMIN) !== 1 ||
    countFor(AdminRole.SUPER_ADMIN) !== 1
  ) {
    throw new Error(
      'BLOCKED — The database does not contain exactly one ADMIN and one SUPER_ADMIN after provisioning.',
    )
  }
}

const seedContent = async () => {
  const repository = new PrismaContentRepository()
  const service = new ContentService(repository)
  const manifest = await loadManifest()
  const ids = new Map<string, string>()

  for (const rawInput of countries) {
    const record = await seedOne(
      service,
      repository,
      manifest,
      'countries',
      rawInput,
    )
    ids.set(record.slug, record.id)
  }

  for (const seed of universitySeeds) {
    const record = await seedOne(
      service,
      repository,
      manifest,
      'universities',
      { ...seed.input, countryId: ids.get(seed.countrySlug) },
    )
    ids.set(record.slug, record.id)
  }

  for (const seed of scholarshipSeeds) {
    const record = await seedOne(
      service,
      repository,
      manifest,
      'scholarships',
      { ...seed.input, countryId: ids.get(seed.countrySlug) },
    )
    ids.set(record.slug, record.id)
  }

  for (const rawInput of services) {
    const record = await seedOne(
      service,
      repository,
      manifest,
      'services',
      rawInput,
    )
    ids.set(record.slug, record.id)
  }

  for (const seed of articleSeeds) {
    await seedOne(service, repository, manifest, 'articles', {
      ...seed.input,
      countryId: ids.get(seed.countrySlug),
      universityId: ids.get(seed.universitySlug),
      scholarshipId: ids.get(seed.scholarshipSlug),
    })
  }

  const counts = Object.fromEntries(
    resources.map((resource) => [
      resource,
      manifest.content.filter(({ resource: entryResource }) => entryResource === resource)
        .length,
    ]),
  )
  console.log(`Seed manifest: ${manifestPath}`)
  console.log(`Manifest content counts: ${JSON.stringify(counts)}`)
}

const command = process.argv[2]

try {
  if (command === 'inspect') await inspect()
  else if (command === 'provision-admins') await provisionAccounts()
  else if (command === 'seed-content') await seedContent()
  else {
    throw new Error(
      'Use one explicit command: inspect, provision-admins, or seed-content.',
    )
  }
} catch (error) {
  const message = error instanceof Error ? error.message : 'Initial data command failed.'
  if (
    message.startsWith('BLOCKED') ||
    message.startsWith('The existing seed manifest') ||
    message.startsWith('Use one explicit command')
  ) {
    console.error(message)
  } else if (error instanceof z.ZodError) {
    console.error('BLOCKED — Credential or seed validation failed. No secret values were displayed.')
  } else {
    console.error('Initial data command failed. No credentials or database details were displayed.')
  }
  process.exitCode = 1
} finally {
  await disconnectPrisma()
}
