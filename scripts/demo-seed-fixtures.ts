import { createHash } from 'node:crypto'

export type DemoVisibility = 'private' | 'published'

export type DemoModel =
  | 'Country'
  | 'City'
  | 'AcademicMajor'
  | 'University'
  | 'UniversityProgram'
  | 'UniversityProgramLanguage'
  | 'UniversityProgramTuition'
  | 'UniversityAdmissionRequirement'
  | 'UniversityGalleryImage'
  | 'Scholarship'
  | 'Service'
  | 'FaqEntry'
  | 'Article'
  | 'ArticleScholarship'
  | 'StudentApplication'
  | 'GeneralInquiry'
  | 'AnalyticsEvent'

export type DemoFixture = {
  key: string
  model: DemoModel
  id: string | null
  data: Record<string, unknown>
  sourceUrl: string | null
}

const id = (value: number) =>
  `d3e00000-0000-4000-8000-${value.toString().padStart(12, '0')}`

const VERIFIED_AT = new Date('2026-11-03T00:00:00.000Z')

const statusFor = (
  visibility: DemoVisibility,
  intended: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED',
) => visibility === 'private' && intended === 'PUBLISHED' ? 'DRAFT' : intended

const publication = (
  visibility: DemoVisibility,
  intended: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED',
  publishedAt: Date,
) => {
  const status = statusFor(visibility, intended)
  return { status, publishedAt: status === 'PUBLISHED' ? publishedAt : null }
}

const record = (
  model: DemoModel,
  key: string,
  identifier: number | null,
  data: Record<string, unknown>,
  sourceUrl: string | null = null,
): DemoFixture => ({
  model,
  key,
  id: identifier === null ? null : id(identifier),
  data,
  sourceUrl,
})

const faq = (
  identifier: number,
  key: string,
  scope: 'GLOBAL' | 'COUNTRY' | 'UNIVERSITY' | 'SERVICE' | 'SCHOLARSHIP',
  parent: Partial<Record<'countryId' | 'universityId' | 'serviceId' | 'scholarshipId', string>>,
  displayOrder: number,
  questionAr: string,
  answerAr: string,
  visibility: DemoVisibility,
  publishedAt: Date,
  intended: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' = 'PUBLISHED',
) => record('FaqEntry', key, identifier, {
  id: id(identifier),
  scope,
  questionAr,
  answerAr,
  questionEn: null,
  answerEn: null,
  displayOrder,
  countryId: null,
  universityId: null,
  serviceId: null,
  scholarshipId: null,
  ...parent,
  ...publication(visibility, intended, publishedAt),
})

export const buildDemoFixtures = (
  baseTime: Date,
  visibility: DemoVisibility,
): DemoFixture[] => {
  const publishedAt = new Date(baseTime.getTime() - 7 * 24 * 60 * 60 * 1_000)
  const finlandId = id(1)
  const estoniaId = id(2)
  const luxembourgId = id(3)
  const helsinkiCityId = id(101)
  const tartuCityId = id(102)
  const luxembourgCityId = id(103)
  const espooCityId = id(104)
  const computerScienceId = id(201)
  const dataScienceId = id(202)
  const softwareEngineeringId = id(203)
  const helsinkiUniversityId = id(301)
  const tartuUniversityId = id(302)
  const luxembourgUniversityId = id(303)
  const aaltoUniversityId = id(304)
  const helsinkiComputerScienceId = id(401)
  const helsinkiDataScienceId = id(402)
  const tartuComputerScienceId = id(403)
  const tartuSoftwareEngineeringId = id(404)
  const luxembourgComputerScienceId = id(405)
  const helsinkiScholarshipId = id(801)
  const tartuScholarshipId = id(802)
  const openDemoScholarshipId = id(803)
  const archivedDemoScholarshipId = id(804)
  const consultationServiceId = id(901)
  const fileReviewServiceId = id(902)
  const archivedServiceId = id(903)
  const articleOneId = id(1_101)
  const articleTwoId = id(1_102)
  const articleThreeId = id(1_103)

  const fixtures: DemoFixture[] = [
    record('Country', 'country.finland', 1, {
      id: finlandId,
      slug: 'demo-e2e-finland',
      nameAr: 'فنلندا — بيانات اختبار مؤقتة',
      nameEn: 'Finland — Temporary test data',
      introductionAr: 'سجل مؤقت لاختبار دليل الدول. يجب التحقق من كل برنامج من مصدره الرسمي.',
      introductionEn: null,
      detailsAr: 'بيانات اختبار قابلة للإزالة ولا تمثل استشارة قبول أو إقامة.',
      detailsEn: null,
      imageUrl: null,
      imageAltAr: null,
      imageAltEn: null,
      featured: true,
      displayOrder: 90,
      seoTitleAr: null,
      seoDescriptionAr: null,
      ...publication(visibility, 'PUBLISHED', publishedAt),
    }),
    record('Country', 'country.estonia', 2, {
      id: estoniaId,
      slug: 'demo-e2e-estonia',
      nameAr: 'إستونيا — بيانات اختبار مؤقتة',
      nameEn: 'Estonia — Temporary test data',
      introductionAr: 'سجل مؤقت لاختبار البحث والمرشحات والعلاقات الجامعية.',
      introductionEn: null,
      detailsAr: 'ارجع دائماً إلى الجامعة والجهات الرسمية قبل اتخاذ قرار.',
      detailsEn: null,
      imageUrl: null,
      imageAltAr: null,
      imageAltEn: null,
      featured: false,
      displayOrder: 91,
      seoTitleAr: null,
      seoDescriptionAr: null,
      ...publication(visibility, 'PUBLISHED', publishedAt),
    }),
    record('Country', 'country.luxembourg', 3, {
      id: luxembourgId,
      slug: 'demo-e2e-luxembourg',
      nameAr: 'لوكسمبورغ — بيانات اختبار مؤقتة',
      nameEn: 'Luxembourg — Temporary test data',
      introductionAr: 'سجل مؤقت لاختبار البرامج متعددة اللغات والرسوم الفصلية.',
      introductionEn: null,
      detailsAr: 'المعلومات الأكاديمية التفصيلية مرتبطة بمصادر الجامعة الرسمية.',
      detailsEn: null,
      imageUrl: null,
      imageAltAr: null,
      imageAltEn: null,
      featured: false,
      displayOrder: 92,
      seoTitleAr: null,
      seoDescriptionAr: null,
      ...publication(visibility, 'PUBLISHED', publishedAt),
    }),

    record('City', 'city.helsinki', 101, {
      id: helsinkiCityId, countryId: finlandId, slug: 'demo-e2e-helsinki',
      nameAr: 'هلسنكي — اختبار', nameEn: 'Helsinki — Test',
    }),
    record('City', 'city.tartu', 102, {
      id: tartuCityId, countryId: estoniaId, slug: 'demo-e2e-tartu',
      nameAr: 'تارتو — اختبار', nameEn: 'Tartu — Test',
    }),
    record('City', 'city.luxembourg', 103, {
      id: luxembourgCityId, countryId: luxembourgId, slug: 'demo-e2e-luxembourg-city',
      nameAr: 'مدينة لوكسمبورغ — اختبار', nameEn: 'Luxembourg City — Test',
    }),
    record('City', 'city.espoo', 104, {
      id: espooCityId, countryId: finlandId, slug: 'demo-e2e-espoo',
      nameAr: 'إسبو — اختبار', nameEn: 'Espoo — Test',
    }),

    record('AcademicMajor', 'major.computer-science', 201, {
      id: computerScienceId, slug: 'demo-e2e-computer-science',
      nameAr: 'علوم الحاسوب — اختبار', nameEn: 'Computer Science — Test', category: 'COMPUTING',
    }),
    record('AcademicMajor', 'major.data-science', 202, {
      id: dataScienceId, slug: 'demo-e2e-data-science',
      nameAr: 'علم البيانات — اختبار', nameEn: 'Data Science — Test', category: 'COMPUTING',
    }),
    record('AcademicMajor', 'major.software-engineering', 203, {
      id: softwareEngineeringId, slug: 'demo-e2e-software-engineering',
      nameAr: 'هندسة البرمجيات — اختبار', nameEn: 'Software Engineering — Test', category: 'COMPUTING',
    }),

    record('University', 'university.helsinki', 301, {
      id: helsinkiUniversityId, countryId: finlandId, cityId: helsinkiCityId,
      universityType: 'PUBLIC', slug: 'demo-e2e-university-of-helsinki',
      nameAr: 'جامعة هلسنكي — سجل اختبار', nameEn: 'University of Helsinki — Test record',
      officialName: 'University of Helsinki', cityAr: 'هلسنكي', cityEn: 'Helsinki',
      overviewAr: 'سجل مؤقت لجامعة حقيقية؛ تفاصيل البرامج أدناه مستندة إلى صفحات الجامعة الرسمية.',
      overviewEn: null, officialWebsite: 'https://www.helsinki.fi/en',
      imageUrl: null, imageAltAr: null, imageAltEn: null, featured: true,
      seoTitleAr: null, seoDescriptionAr: null,
      ...publication(visibility, 'PUBLISHED', publishedAt),
    }, 'https://www.helsinki.fi/en'),
    record('University', 'university.tartu', 302, {
      id: tartuUniversityId, countryId: estoniaId, cityId: tartuCityId,
      universityType: 'PUBLIC', slug: 'demo-e2e-university-of-tartu',
      nameAr: 'جامعة تارتو — سجل اختبار', nameEn: 'University of Tartu — Test record',
      officialName: 'University of Tartu', cityAr: 'تارتو', cityEn: 'Tartu',
      overviewAr: 'سجل مؤقت لجامعة حقيقية مع برامج موثقة من صفحات الجامعة الرسمية.',
      overviewEn: null, officialWebsite: 'https://ut.ee/en',
      imageUrl: null, imageAltAr: null, imageAltEn: null, featured: true,
      seoTitleAr: null, seoDescriptionAr: null,
      ...publication(visibility, 'PUBLISHED', publishedAt),
    }, 'https://ut.ee/en'),
    record('University', 'university.luxembourg', 303, {
      id: luxembourgUniversityId, countryId: luxembourgId, cityId: luxembourgCityId,
      universityType: 'PUBLIC', slug: 'demo-e2e-university-of-luxembourg',
      nameAr: 'جامعة لوكسمبورغ — سجل اختبار', nameEn: 'University of Luxembourg — Test record',
      officialName: 'University of Luxembourg', cityAr: 'مدينة لوكسمبورغ', cityEn: 'Luxembourg City',
      overviewAr: 'سجل مؤقت لاختبار برنامج بكالوريوس موثق ورسوم فصلية.',
      overviewEn: null, officialWebsite: 'https://www.uni.lu/en/',
      imageUrl: null, imageAltAr: null, imageAltEn: null, featured: false,
      seoTitleAr: null, seoDescriptionAr: null,
      ...publication(visibility, 'PUBLISHED', publishedAt),
    }, 'https://www.uni.lu/en/'),
    record('University', 'university.aalto-without-programs', 304, {
      id: aaltoUniversityId, countryId: finlandId, cityId: espooCityId,
      universityType: 'PUBLIC', slug: 'demo-e2e-aalto-no-programs',
      nameAr: 'جامعة آلتو — سجل اختبار بلا برامج', nameEn: 'Aalto University — Test record without programs',
      officialName: 'Aalto University', cityAr: 'إسبو', cityEn: 'Espoo',
      overviewAr: 'سجل مسودة مؤقت لاختبار ظهور جامعة بلا بيانات برامج عند غياب مرشحات البرامج.',
      overviewEn: null, officialWebsite: 'https://www.aalto.fi/en',
      imageUrl: null, imageAltAr: null, imageAltEn: null, featured: false,
      seoTitleAr: null, seoDescriptionAr: null,
      ...publication(visibility, 'PUBLISHED', publishedAt),
    }, 'https://www.aalto.fi/en'),

    record('UniversityProgram', 'program.helsinki-computer-science', 401, {
      id: helsinkiComputerScienceId, universityId: helsinkiUniversityId,
      academicMajorId: computerScienceId, nameAr: 'ماجستير علوم الحاسوب',
      nameEn: 'Master’s Programme in Computer Science', facultyNameAr: 'كلية العلوم',
      facultyNameEn: 'Faculty of Science', durationValue: 2, durationUnit: 'YEARS',
      studyLevel: 'MASTERS', officialSourceUrl: 'https://www.helsinki.fi/en/degree-programmes/computer-science-masters-programme',
      verifiedAt: VERIFIED_AT, ...publication(visibility, 'PUBLISHED', publishedAt),
    }, 'https://www.helsinki.fi/en/degree-programmes/computer-science-masters-programme'),
    record('UniversityProgram', 'program.helsinki-data-science', 402, {
      id: helsinkiDataScienceId, universityId: helsinkiUniversityId,
      academicMajorId: dataScienceId, nameAr: 'ماجستير علم البيانات',
      nameEn: 'Master’s Programme in Data Science', facultyNameAr: 'كلية العلوم',
      facultyNameEn: 'Faculty of Science', durationValue: 2, durationUnit: 'YEARS',
      studyLevel: 'MASTERS', officialSourceUrl: 'https://www.helsinki.fi/en/degree-programmes/data-science-masters-programme',
      verifiedAt: VERIFIED_AT, ...publication(visibility, 'PUBLISHED', publishedAt),
    }, 'https://www.helsinki.fi/en/degree-programmes/data-science-masters-programme'),
    record('UniversityProgram', 'program.tartu-computer-science', 403, {
      id: tartuComputerScienceId, universityId: tartuUniversityId,
      academicMajorId: computerScienceId, nameAr: 'ماجستير علوم الحاسوب',
      nameEn: 'Computer Science MSc', facultyNameAr: 'معهد علوم الحاسوب',
      facultyNameEn: 'Institute of Computer Science', durationValue: 2, durationUnit: 'YEARS',
      studyLevel: 'MASTERS', officialSourceUrl: 'https://ut.ee/en/curriculum/computer-science',
      verifiedAt: VERIFIED_AT, ...publication(visibility, 'PUBLISHED', publishedAt),
    }, 'https://ut.ee/en/curriculum/computer-science'),
    record('UniversityProgram', 'program.tartu-software-engineering', 404, {
      id: tartuSoftwareEngineeringId, universityId: tartuUniversityId,
      academicMajorId: softwareEngineeringId, nameAr: 'ماجستير هندسة البرمجيات',
      nameEn: 'Software Engineering MSc', facultyNameAr: 'معهد علوم الحاسوب',
      facultyNameEn: 'Institute of Computer Science', durationValue: 2, durationUnit: 'YEARS',
      studyLevel: 'MASTERS', officialSourceUrl: 'https://ut.ee/en/curriculum/software-engineering',
      verifiedAt: VERIFIED_AT, ...publication(visibility, 'PUBLISHED', publishedAt),
    }, 'https://ut.ee/en/curriculum/software-engineering'),
    record('UniversityProgram', 'program.luxembourg-computer-science', 405, {
      id: luxembourgComputerScienceId, universityId: luxembourgUniversityId,
      academicMajorId: computerScienceId, nameAr: 'بكالوريوس علوم الحاسوب',
      nameEn: 'Bachelor in Computer Science', facultyNameAr: 'كلية العلوم والتكنولوجيا والطب',
      facultyNameEn: 'Faculty of Science, Technology and Medicine', durationValue: 3, durationUnit: 'YEARS',
      studyLevel: 'BACHELORS', officialSourceUrl: 'https://www.uni.lu/fstm-en/study-programs/bachelor-in-computer-science/',
      verifiedAt: VERIFIED_AT, ...publication(visibility, 'PUBLISHED', publishedAt),
    }, 'https://www.uni.lu/fstm-en/study-programs/bachelor-in-computer-science/'),

    ...[
      [helsinkiComputerScienceId, 'ENGLISH'],
      [helsinkiDataScienceId, 'ENGLISH'],
      [tartuComputerScienceId, 'ENGLISH'],
      [tartuSoftwareEngineeringId, 'ENGLISH'],
      [luxembourgComputerScienceId, 'ENGLISH'],
      [luxembourgComputerScienceId, 'FRENCH'],
    ].map(([programId, language], index) => record(
      'UniversityProgramLanguage', `program-language.${index + 1}`, null,
      { programId, language },
    )),

    record('UniversityProgramTuition', 'tuition.helsinki-cs-2026', 501, {
      id: id(501), programId: helsinkiComputerScienceId, amount: '15000.00',
      currency: 'EUR', billingPeriod: 'YEAR', academicYear: '2026/2027',
    }, 'https://www.helsinki.fi/en/degree-programmes/computer-science-masters-programme'),
    record('UniversityProgramTuition', 'tuition.tartu-cs-2026', 502, {
      id: id(502), programId: tartuComputerScienceId, amount: '7200.00',
      currency: 'EUR', billingPeriod: 'YEAR', academicYear: '2026/2027',
    }, 'https://ut.ee/en/curriculum/computer-science'),
    record('UniversityProgramTuition', 'tuition.luxembourg-cs-2026', 503, {
      id: id(503), programId: luxembourgComputerScienceId, amount: '400.00',
      currency: 'EUR', billingPeriod: 'SEMESTER', academicYear: '2026/2027',
    }, 'https://www.uni.lu/fstm-en/study-programs/bachelor-in-computer-science/admissions/'),

    record('UniversityAdmissionRequirement', 'admission.helsinki-masters', 601, {
      id: id(601), universityId: helsinkiUniversityId, scope: 'STUDY_LEVEL',
      studyLevel: 'MASTERS', programId: null,
      contentAr: 'ملخص اختبار موثق: تتطلب برامج الماجستير الإنجليزية إثبات الكفاءة باللغة الإنجليزية، مع الرجوع إلى متطلبات البرنامج المحدد.',
      contentEn: null, officialSourceUrl: 'https://www.helsinki.fi/en/admissions-and-education/admission-services-and-study-guidance',
      verifiedAt: VERIFIED_AT, ...publication(visibility, 'PUBLISHED', publishedAt),
    }, 'https://www.helsinki.fi/en/admissions-and-education/admission-services-and-study-guidance'),
    record('UniversityAdmissionRequirement', 'admission.tartu-computer-science', 602, {
      id: id(602), universityId: tartuUniversityId, scope: 'PROGRAM',
      studyLevel: null, programId: tartuComputerScienceId,
      contentAr: 'ملخص اختبار موثق: يجب استخدام صفحة البرنامج الرسمية للتحقق من فترة التقديم ومتطلبات القبول والوثائق.',
      contentEn: null, officialSourceUrl: 'https://cs.ut.ee/en/content/computer-science-msc',
      verifiedAt: VERIFIED_AT, ...publication(visibility, 'PUBLISHED', publishedAt),
    }, 'https://cs.ut.ee/en/content/computer-science-msc'),
    record('UniversityAdmissionRequirement', 'admission.demo-draft-null-source', 603, {
      id: id(603), universityId: luxembourgUniversityId, scope: 'UNIVERSITY',
      studyLevel: null, programId: null,
      contentAr: 'بيانات تجريبية فقط لاختبار حالة متطلب مسودة بلا مصدر؛ لا تمثل سياسة قبول.',
      contentEn: null, officialSourceUrl: null, verifiedAt: null,
      ...publication(visibility, 'DRAFT', publishedAt),
    }),

    ...[helsinkiUniversityId, tartuUniversityId, luxembourgUniversityId].map(
      (universityId, index) => record('UniversityGalleryImage', `gallery.draft-${index + 1}`, 701 + index, {
        id: id(701 + index), universityId,
        imageUrl: `https://example.invalid/tareeq-demo/university-${index + 1}.jpg`,
        altAr: 'صورة تجريبية غير منشورة', altEn: 'Unpublished demo image',
        displayOrder: index, ...publication(visibility, 'DRAFT', publishedAt),
      }),
    ),

    record('Scholarship', 'scholarship.helsinki-reference', 801, {
      id: helsinkiScholarshipId, slug: 'demo-e2e-helsinki-scholarship-reference',
      titleAr: 'برنامج منح جامعة هلسنكي — مرجع اختبار مغلق',
      titleEn: 'University of Helsinki scholarship programme — closed test reference',
      countryId: finlandId, universityId: helsinkiUniversityId,
      studyLevel: 'MASTERS', fundingType: 'TUITION_FEE_WAIVER',
      requirementsAr: 'مرجع اختبار يستند إلى صفحة الجامعة؛ يجب الرجوع إلى دورة التقديم الحالية.',
      requirementsEn: null, descriptionAr: 'سجل مؤقت مغلق لاختبار عرض فرص التمويل المرتبطة بجامعة.',
      descriptionEn: null, imageUrl: null, imageAltAr: null, imageAltEn: null,
      verifiedDeadline: null, officialSourceUrl: 'https://www.helsinki.fi/en/admissions-and-education/apply-bachelors-and-masters-programmes/tuition-fees-and-scholarship-programme',
      applicationStatus: 'CLOSED', featured: true, seoTitleAr: null, seoDescriptionAr: null,
      ...publication(visibility, 'PUBLISHED', publishedAt),
    }, 'https://www.helsinki.fi/en/admissions-and-education/apply-bachelors-and-masters-programmes/tuition-fees-and-scholarship-programme'),
    record('Scholarship', 'scholarship.tartu-reference', 802, {
      id: tartuScholarshipId, slug: 'demo-e2e-tartu-tuition-reduction-reference',
      titleAr: 'تخفيضات رسوم جامعة تارتو — مرجع اختبار مغلق',
      titleEn: 'University of Tartu tuition reductions — closed test reference',
      countryId: estoniaId, universityId: tartuUniversityId,
      studyLevel: 'MASTERS', fundingType: 'TUITION_REDUCTION',
      requirementsAr: 'مرجع اختبار؛ تعتمد الأهلية الفعلية على البرنامج ودورة القبول الحالية.',
      requirementsEn: null, descriptionAr: 'سجل مؤقت مغلق مرتبط بمصدر الجامعة الرسمي للرسوم والتخفيضات.',
      descriptionEn: null, imageUrl: null, imageAltAr: null, imageAltEn: null,
      verifiedDeadline: null, officialSourceUrl: 'https://keemia.ut.ee/en/content/cost-tuition',
      applicationStatus: 'CLOSED', featured: false, seoTitleAr: null, seoDescriptionAr: null,
      ...publication(visibility, 'PUBLISHED', publishedAt),
    }, 'https://keemia.ut.ee/en/content/cost-tuition'),
    record('Scholarship', 'scholarship.synthetic-open-draft', 803, {
      id: openDemoScholarshipId, slug: 'demo-e2e-synthetic-open-opportunity',
      titleAr: '[بيانات تجريبية] فرصة مفتوحة لاختبار الواجهة', titleEn: '[Demo data] Open opportunity',
      countryId: luxembourgId, universityId: luxembourgUniversityId,
      studyLevel: 'BACHELORS', fundingType: 'DEMO_ONLY',
      requirementsAr: 'بيانات تركيبية للاختبار فقط وليست منحة حقيقية.', requirementsEn: null,
      descriptionAr: 'تبقى مسودة دائماً ولا يجوز نشرها.', descriptionEn: null,
      imageUrl: null, imageAltAr: null, imageAltEn: null, verifiedDeadline: null,
      officialSourceUrl: null, applicationStatus: 'OPEN', featured: false,
      seoTitleAr: null, seoDescriptionAr: null, ...publication(visibility, 'DRAFT', publishedAt),
    }),
    record('Scholarship', 'scholarship.synthetic-archived', 804, {
      id: archivedDemoScholarshipId, slug: 'demo-e2e-synthetic-archived-opportunity',
      titleAr: '[بيانات تجريبية] فرصة مؤرشفة', titleEn: '[Demo data] Archived opportunity',
      countryId: finlandId, universityId: null, studyLevel: 'BACHELORS', fundingType: 'DEMO_ONLY',
      requirementsAr: 'بيانات تركيبية للاختبار فقط.', requirementsEn: null,
      descriptionAr: 'سجل مؤرشف لاختبار حالات الإدارة.', descriptionEn: null,
      imageUrl: null, imageAltAr: null, imageAltEn: null, verifiedDeadline: null,
      officialSourceUrl: null, applicationStatus: 'CLOSED', featured: false,
      seoTitleAr: null, seoDescriptionAr: null, ...publication(visibility, 'ARCHIVED', publishedAt),
    }),

    record('Service', 'service.consultation', 901, {
      id: consultationServiceId, slug: 'demo-e2e-consultation-service',
      titleAr: '[بيانات تجريبية] استشارة اختيار البرنامج', titleEn: null,
      summaryAr: 'خدمة مؤقتة لاختبار إدارة المحتوى.', summaryEn: null,
      descriptionAr: 'لا تمثل عرضاً تجارياً حقيقياً ولا تتضمن ضمان قبول.', descriptionEn: null,
      imageUrl: null, imageAltAr: null, imageAltEn: null, featured: true,
      displayOrder: 90, seoTitleAr: null, seoDescriptionAr: null,
      ...publication(visibility, 'PUBLISHED', publishedAt),
    }),
    record('Service', 'service.file-review', 902, {
      id: fileReviewServiceId, slug: 'demo-e2e-file-review-service',
      titleAr: '[بيانات تجريبية] مراجعة ملف', titleEn: null,
      summaryAr: 'مسودة مؤقتة لاختبار الحقول الفارغة.', summaryEn: null,
      descriptionAr: 'بيانات اختبار فقط.', descriptionEn: null,
      imageUrl: null, imageAltAr: null, imageAltEn: null, featured: false,
      displayOrder: 91, seoTitleAr: null, seoDescriptionAr: null,
      ...publication(visibility, 'DRAFT', publishedAt),
    }),
    record('Service', 'service.archived', 903, {
      id: archivedServiceId, slug: 'demo-e2e-archived-service',
      titleAr: '[بيانات تجريبية] خدمة مؤرشفة', titleEn: null,
      summaryAr: 'سجل مؤقت لاختبار الأرشفة.', summaryEn: null,
      descriptionAr: 'بيانات اختبار فقط.', descriptionEn: null,
      imageUrl: null, imageAltAr: null, imageAltEn: null, featured: false,
      displayOrder: 92, seoTitleAr: null, seoDescriptionAr: null,
      ...publication(visibility, 'ARCHIVED', publishedAt),
    }),
  ]

  const globalFaqs = [
    ['ما الغرض من هذه البيانات؟', 'هي بيانات اختبار مؤقتة قابلة للإزالة ولا تمثل محتوى إنتاجياً.'],
    ['كيف أتحقق من البرنامج؟', 'استخدم رابط المصدر الرسمي المرفق بكل برنامج.'],
    ['هل الرسوم تقديرية؟', 'لا؛ أُدخلت الرسوم فقط عندما وفر المصدر الرسمي قيمة صريحة.'],
    ['هل بيانات الطلبة حقيقية؟', 'لا؛ جميع هويات الطلبات والاستفسارات تركيبية وتنتهي بنطاق example.invalid.'],
    ['هل يمكن الاعتماد على سجل المسودة؟', 'لا؛ سجلات المسودة مخصصة لاختبار الإدارة فقط.'],
    ['كيف تُعرض أسئلة إضافية؟', 'تستخدم الواجهة التصفح لتحميل الأسئلة بعد أول خمسة.'],
    ['هل السؤال السابع منشور؟', 'هذا السؤال مسودة لاختبار فصل حالات النشر.'],
  ]
  globalFaqs.forEach(([question, answer], index) => fixtures.push(faq(
    1_201 + index, `faq.global-${index + 1}`, 'GLOBAL', {}, index,
    question!, answer!, visibility, publishedAt, index === 6 ? 'DRAFT' : 'PUBLISHED',
  )))
  fixtures.push(
    faq(1_211, 'faq.country-finland-1', 'COUNTRY', { countryId: finlandId }, 0, 'هل هذا سجل فنلندا الإنتاجي؟', 'لا، يحمل slug ومعروضاً واضحين لبيانات الاختبار.', visibility, publishedAt),
    faq(1_212, 'faq.country-finland-2', 'COUNTRY', { countryId: finlandId }, 1, 'أين أتحقق من البرامج؟', 'من روابط الجامعات والبرامج الرسمية.', visibility, publishedAt),
    faq(1_213, 'faq.country-estonia-draft', 'COUNTRY', { countryId: estoniaId }, 0, 'سؤال مسودة للدولة', 'يختبر عدم ظهور المسودات للعامة.', visibility, publishedAt, 'DRAFT'),
    faq(1_221, 'faq.university-helsinki-1', 'UNIVERSITY', { universityId: helsinkiUniversityId }, 0, 'هل الرسوم موثقة؟', 'قيمة برنامج علوم الحاسوب مرتبطة بصفحة البرنامج الرسمية.', visibility, publishedAt),
    faq(1_222, 'faq.university-helsinki-2', 'UNIVERSITY', { universityId: helsinkiUniversityId }, 1, 'هل كل البرامج لها رسوم مدخلة؟', 'لا، تُترك القيمة غير المعروفة فارغة.', visibility, publishedAt),
    faq(1_223, 'faq.university-tartu-1', 'UNIVERSITY', { universityId: tartuUniversityId }, 0, 'ما لغة البرنامج؟', 'تُعرض لغة التدريس الموثقة مع البرنامج.', visibility, publishedAt),
    faq(1_224, 'faq.university-luxembourg-archived', 'UNIVERSITY', { universityId: luxembourgUniversityId }, 0, 'سؤال مؤرشف', 'يختبر الأرشفة.', visibility, publishedAt, 'ARCHIVED'),
    faq(1_231, 'faq.service-1', 'SERVICE', { serviceId: consultationServiceId }, 0, 'هل الخدمة حقيقية؟', 'لا، هي بيانات تجريبية واضحة.', visibility, publishedAt),
    faq(1_232, 'faq.service-2', 'SERVICE', { serviceId: consultationServiceId }, 1, 'هل تضمن القبول؟', 'لا، ولا يجوز تقديم أي ضمان قبول.', visibility, publishedAt),
    faq(1_241, 'faq.scholarship-1', 'SCHOLARSHIP', { scholarshipId: helsinkiScholarshipId }, 0, 'هل هذه الدورة مفتوحة؟', 'لا، السجل مرجع مغلق للاختبار.', visibility, publishedAt),
    faq(1_242, 'faq.scholarship-2', 'SCHOLARSHIP', { scholarshipId: openDemoScholarshipId }, 0, 'هل هذه فرصة حقيقية؟', 'لا، هي مسودة تركيبية لاختبار حالة OPEN.', visibility, publishedAt, 'DRAFT'),
  )

  fixtures.push(
    record('Article', 'article.multiple-scholarships', 1_101, {
      id: articleOneId, slug: 'demo-e2e-multiple-related-scholarships',
      titleAr: '[بيانات تجريبية] مقارنة فرص التمويل', titleEn: null,
      summaryAr: 'مقال مؤقت لاختبار عدة منح مرتبطة.', summaryEn: null,
      bodyAr: [{ type: 'paragraph', text: 'هذا نص تجريبي ولا يقدم توصية مالية أو أكاديمية.' }],
      bodyEn: null, coverImageUrl: null, coverImageAltAr: null, coverImageAltEn: null,
      countryId: finlandId, universityId: helsinkiUniversityId,
      scholarshipId: helsinkiScholarshipId, featured: true,
      seoTitleAr: null, seoDescriptionAr: null, ...publication(visibility, 'PUBLISHED', publishedAt),
    }),
    record('Article', 'article.draft-null-optionals', 1_102, {
      id: articleTwoId, slug: 'demo-e2e-draft-null-optionals',
      titleAr: '[بيانات تجريبية] مقال مسودة', titleEn: null,
      summaryAr: 'يختبر الحقول الاختيارية الفارغة.', summaryEn: null,
      bodyAr: [{ type: 'paragraph', text: 'بيانات اختبار فقط.' }], bodyEn: null,
      coverImageUrl: null, coverImageAltAr: null, coverImageAltEn: null,
      countryId: null, universityId: null, scholarshipId: openDemoScholarshipId,
      featured: false, seoTitleAr: null, seoDescriptionAr: null,
      ...publication(visibility, 'DRAFT', publishedAt),
    }),
    record('Article', 'article.archived', 1_103, {
      id: articleThreeId, slug: 'demo-e2e-archived-article',
      titleAr: '[بيانات تجريبية] مقال مؤرشف', titleEn: null,
      summaryAr: 'يختبر حالة الأرشفة.', summaryEn: null,
      bodyAr: [{ type: 'paragraph', text: 'بيانات اختبار فقط.' }], bodyEn: null,
      coverImageUrl: null, coverImageAltAr: null, coverImageAltEn: null,
      countryId: estoniaId, universityId: tartuUniversityId,
      scholarshipId: tartuScholarshipId, featured: false,
      seoTitleAr: null, seoDescriptionAr: null, ...publication(visibility, 'ARCHIVED', publishedAt),
    }),
  )

  ;[
    [articleOneId, helsinkiScholarshipId, 0],
    [articleOneId, tartuScholarshipId, 1],
    [articleOneId, openDemoScholarshipId, 2],
    [articleTwoId, openDemoScholarshipId, 0],
    [articleTwoId, archivedDemoScholarshipId, 1],
    [articleThreeId, tartuScholarshipId, 0],
  ].forEach(([articleId, scholarshipId, displayOrder], index) => fixtures.push(record(
    'ArticleScholarship', `article-scholarship.${index + 1}`, null,
    { articleId, scholarshipId, displayOrder },
  )))

  const applicationStatuses = ['NEW', 'IN_REVIEW', 'RESOLVED', 'CLOSED'] as const
  applicationStatuses.forEach((status, index) => fixtures.push(record(
    'StudentApplication', `application.${status.toLowerCase()}`, 1_301 + index,
    {
      id: id(1_301 + index),
      applicationType: index % 2 === 0 ? 'UNIVERSITY_ADMISSION' : 'SCHOLARSHIP_ASSISTANCE',
      scholarshipId: index % 2 === 0 ? null : openDemoScholarshipId,
      countryId: index < 2 ? finlandId : estoniaId,
      universityId: index < 2 ? helsinkiUniversityId : tartuUniversityId,
      studyLevel: index % 2 === 0 ? 'MASTERS' : null,
      intendedMajor: index % 2 === 0 ? 'Computer Science — DEMO' : null,
      fullName: `طالب تجريبي ${index + 1}`,
      email: `demo+application-${index + 1}@example.invalid`,
      phone: null,
      message: 'رسالة تركيبية لاختبار سير عمل الطلبات فقط، ولا تخص طالباً حقيقياً.',
      status,
      internalNote: status === 'NEW' ? null : 'ملاحظة اختبار داخلية بلا بيانات شخصية.',
      privacyAcceptedAt: new Date(baseTime.getTime() - (index + 1) * 60 * 60 * 1_000),
    },
  )))

  applicationStatuses.forEach((status, index) => fixtures.push(record(
    'GeneralInquiry', `inquiry.${status.toLowerCase()}`, 1_401 + index,
    {
      id: id(1_401 + index), fullName: `مستفسر تجريبي ${index + 1}`,
      email: `demo+inquiry-${index + 1}@example.invalid`, phone: null,
      subject: `[DEMO] استفسار تجريبي ${index + 1}`,
      message: 'رسالة تركيبية لاختبار حالات الاستفسار فقط.', status,
      internalNote: status === 'NEW' ? null : 'ملاحظة اختبار داخلية.',
      privacyAcceptedAt: new Date(baseTime.getTime() - (index + 5) * 60 * 60 * 1_000),
    },
  )))

  const visitorOne = id(1_501)
  const visitorTwo = id(1_502)
  const sessionOne = id(1_511)
  const sessionTwo = id(1_512)
  const analytics = [
    { visitorId: visitorOne, sessionId: sessionOne, type: 'PAGE_VIEW', path: '/universities', targetPath: null, ctaId: null, engagementType: null },
    { visitorId: visitorOne, sessionId: sessionOne, type: 'PAGE_VIEW', path: '/universities/demo-e2e-university-of-helsinki', targetPath: null, ctaId: null, engagementType: null },
    { visitorId: visitorOne, sessionId: sessionOne, type: 'ENGAGEMENT', path: '/universities/demo-e2e-university-of-helsinki', targetPath: null, ctaId: null, engagementType: 'SCROLL_50' },
    { visitorId: visitorOne, sessionId: sessionOne, type: 'CTA_CLICK', path: '/universities/demo-e2e-university-of-helsinki', targetPath: '/applications', ctaId: 'APPLY_NOW', engagementType: null },
    { visitorId: visitorOne, sessionId: sessionOne, type: 'APPLICATION_SUBMITTED', path: '/applications', targetPath: null, ctaId: null, engagementType: null },
    { visitorId: visitorOne, sessionId: sessionOne, type: 'ENGAGEMENT', path: '/applications', targetPath: null, ctaId: null, engagementType: 'ACTIVE_30_SECONDS' },
    { visitorId: visitorTwo, sessionId: sessionTwo, type: 'PAGE_VIEW', path: '/scholarships', targetPath: null, ctaId: null, engagementType: null },
    { visitorId: visitorTwo, sessionId: sessionTwo, type: 'PAGE_VIEW', path: '/scholarships/demo-e2e-helsinki-scholarship-reference', targetPath: null, ctaId: null, engagementType: null },
    { visitorId: visitorTwo, sessionId: sessionTwo, type: 'CTA_CLICK', path: '/scholarships/demo-e2e-helsinki-scholarship-reference', targetPath: '/inquiries', ctaId: 'REQUEST_CONSULTATION', engagementType: null },
    { visitorId: visitorTwo, sessionId: sessionTwo, type: 'ENGAGEMENT', path: '/scholarships/demo-e2e-helsinki-scholarship-reference', targetPath: null, ctaId: null, engagementType: 'SCROLL_90' },
    { visitorId: visitorTwo, sessionId: sessionTwo, type: 'INQUIRY_SUBMITTED', path: '/inquiries', targetPath: null, ctaId: null, engagementType: null },
    { visitorId: visitorTwo, sessionId: sessionTwo, type: 'ENGAGEMENT', path: '/inquiries', targetPath: null, ctaId: null, engagementType: 'ACTIVE_60_SECONDS' },
  ] as const
  analytics.forEach((event, index) => fixtures.push(record(
    'AnalyticsEvent', `analytics.${index + 1}`, 1_601 + index,
    {
      id: id(1_601 + index), ...event,
      referrerHost: index === 0 || index === 6 ? 'www.google.com' : null,
      referrerPath: index === 0 || index === 6 ? '/search' : null,
      utmSource: index === 0 || index === 6 ? 'google' : null,
      utmMedium: index === 0 || index === 6 ? 'organic' : null,
      utmCampaign: index === 0 || index === 6 ? 'demo-seed' : null,
      utmContent: null, utmTerm: null,
      occurredAt: new Date(baseTime.getTime() - (analytics.length - index) * 5 * 60 * 1_000),
      receivedAt: new Date(baseTime.getTime() - (analytics.length - index) * 5 * 60 * 1_000 + 1_000),
    },
  )))

  return fixtures
}

const canonical = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    if ('toFixed' in value && typeof value.toFixed === 'function') {
      return value.toFixed(2)
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]),
    )
  }
  return value
}

export const fixtureOwnershipHash = (fixture: DemoFixture) =>
  createHash('sha256')
    .update(JSON.stringify(canonical({ model: fixture.model, key: fixture.key, data: fixture.data })))
    .digest('hex')

export const fixtureCounts = (fixtures: DemoFixture[]) => {
  const counts: Record<string, number> = {}
  for (const fixture of fixtures) counts[fixture.model] = (counts[fixture.model] ?? 0) + 1
  return counts
}

export const DEMO_OPERATIONAL_EXCLUSIONS = [
  'AdminUser',
  'RefreshSession',
  'AdminAuditLog',
  'SiteSettings',
  'EmailNotification',
  'PublicSubmissionRateLimit',
] as const
