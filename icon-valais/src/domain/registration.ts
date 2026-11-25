import { z } from 'zod';
import { beltOptions } from './belts';
import { BELTS } from './types';

export function needsParentConsent(age: number, createdByParent: boolean): boolean {
  return age < 16 && !createdByParent;
}

const years = z.number().int('errors.yearsInvalid').min(0, 'errors.yearsInvalid');

export const registrationSchema = z
  .object({
    role: z.enum(['eleve', 'prof', 'admin']),
    firstName: z.string().trim().min(1, 'errors.required'),
    lastName: z.string().trim().min(1, 'errors.required'),
    email: z.string().email('errors.invalidEmail'),
    password: z.string().min(8, 'errors.passwordTooShort'),
    phone: z.string().optional(),
    age: z
      .number('errors.ageRange')
      .int('errors.ageRange')
      .min(0, 'errors.ageRange')
      .max(100, 'errors.ageRange'),
    sports: z.array(z.enum(['jjb', 'grappling', 'mma'])).min(1, 'errors.sportRequired'),
    bjjBelt: z.enum(BELTS).optional(),
    yearsGrappling: years.optional(),
    yearsMma: years.optional(),
    parentEmail: z.string().email('errors.invalidEmail').optional(),
    coachYears: years.optional(),
    trainingPlaces: z.string().optional(),
    competitionAwards: z.string().optional(),
    cv: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    const add = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });

    if (v.sports.includes('jjb')) {
      if (!v.bjjBelt) add('bjjBelt', 'errors.beltRequired');
      else if (!(beltOptions(v.age) as string[]).includes(v.bjjBelt))
        add('bjjBelt', 'errors.beltInvalid');
    }
    if (v.sports.includes('grappling') && v.yearsGrappling === undefined)
      add('yearsGrappling', 'errors.yearsRequired');
    if (v.sports.includes('mma') && v.yearsMma === undefined)
      add('yearsMma', 'errors.yearsRequired');
    if (needsParentConsent(v.age, false) && !v.parentEmail)
      add('parentEmail', 'errors.parentEmailRequired');
    if (v.role === 'prof' && v.coachYears === undefined)
      add('coachYears', 'errors.coachYearsRequired');
  });

export type RegistrationInput = z.infer<typeof registrationSchema>;
