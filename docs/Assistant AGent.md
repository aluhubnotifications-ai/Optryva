# Optryva Internship AI Assistant

## Unified chat and action specification

## 1. Purpose

The Optryva Internship AI Assistant is one context-aware assistant for students, employers, and university career teams. It combines internship discovery, résumé selection, evidence review, skill-gap guidance, assessment support, applications, and hiring workflow assistance.

The interface should feel like one simple chat, while the underlying system uses controlled, permission-checked tools. The assistant must explain its evidence and ask for confirmation before sensitive actions.

> **The assistant helps users move from opportunity discovery to preparation, application, assessment, interview, and outcome.**

## 2. Student capabilities

A student can ask:

| Student request | Assistant behavior |
| --- | --- |
| "Find internships for me." | Uses active résumé profiles and résumé-specific preferences to return the fixed Top 40 results. |
| "Which résumé should I use?" | Compares résumé profiles and recommends the strongest one for the selected role. |
| "Why did I match this role?" | Shows requirements met, evidence, preference fit, missing evidence, and confidence. |
| "What do I need to do to qualify?" | Creates a Fit → Gap → Path → Apply plan. |
| "Analyze my project." | Reviews a permitted link or uploaded file and extracts possible skills and outcomes. |
| "Add this to my résumé." | Creates a draft update linked to the selected résumé and asks for approval. |
| "Prepare me for the assessment." | Explains the published skills and practice areas without revealing protected answer keys. |
| "Help me apply." | Selects the recommended résumé, drafts truthful application materials, and asks for confirmation before submission. |
| "Track my applications." | Summarizes stages, deadlines, responses, interviews, and next actions. |
| "Tell me about this company." | Provides grounded research from permitted public sources and opportunity data. |
| "Add another résumé." | Creates another career direction with its own roles, interests, locations, work modes, and opportunity preferences. |

## 3. Employer capabilities

An employer can ask:

| Employer request | Assistant behavior |
| --- | --- |
| "Create an internship." | Creates a job draft from the employer's description. |
| "Read these role documents." | Extracts essential, preferred, and trainable requirements for approval. |
| "Generate an assessment." | Creates editable job-related questions and a rubric. |
| "Test this assessment." | Checks clarity, time burden, accessibility, role relevance, and scoring consistency. |
| "Show my best candidates." | Returns the explainable Smart Shortlist for the selected job. |
| "Why is Candidate A ranked above B?" | Compares résumé, evidence, preferences, assessment results, and uncertainty. |
| "Review this portfolio." | Inspects permitted public or uploaded evidence and links findings to sources. |
| "Invite these candidates." | Prepares an invitation and requires employer confirmation. |
| "Prepare interview questions." | Generates questions from the approved job requirements and rubric. |
| "Summarize my pipeline." | Shows applicant stages, assessment completion, gaps, and next actions. |
| "Open and analyze Candidate A's portfolio." | Fetches the candidate's external links, extracts evidence, and compares it to the job rubric. |
| "Check this job's external site." | Navigates to the external job link, identifies hidden requirements, and updates the match score. |
| "Reject everyone below 60." | Does not perform hidden bulk rejection; provides a human-review queue instead. |

## 4. Deep Inspection & Auto-Navigation

The assistant doesn't just "talk" about data; it can "see" and "understand" external links provided by students or employers. When a user asks to "open" or "check" a link, the assistant uses its extraction tools to fetch the content, process it, and update the conversation context.

### How "Opening" works

1. **Trigger**: The user clicks a "Deep Inspect" button or asks the chat to "Check this link."

1. **Extraction**: The assistant calls `inspect_external_link` using Crawl4AI/Playwright to fetch the page content (Markdown/Text).

1. **Analysis**: The AI identifies relevant skills, evidence, requirements, or company context from the extracted data.

1. **Feedback**: The assistant explains what it found: "I opened the portfolio. I found evidence of React and UI design in the 'Optryva Audit' project, which matches your 'Frontend Developer' requirement."

1. **Action**: The assistant offers to update the résumé, job description, or shortlist score based on the new findings.

### Smart Shortlist "Deep Dive"

When an employer views the Smart Shortlist, they can ask the assistant to "Deep Dive" into a candidate. The assistant will:

- Open all evidence links (GitHub, Portfolios, Documents).

- Verify if the claims in the résumé are supported by the external content.

- Flag discrepancies or "Strong Proof" items.

- Provide a "Proof Summary" that explains *why* the candidate is ranked where they are, based on actual work samples.

## 5. University capabilities

A university or career office can ask:

- "Publish this verified internship to eligible students."

- "Show opportunities that match our final-year students."

- "Which students have not completed their profiles?"

- "How many students reached interviews this month?"

- "Which employers need follow-up?"

- "Show applications and placements by programme."

University staff should only access students and opportunities allowed by institution permissions and student consent.

## 6. Student conversation examples

### Find opportunities

Student: "I want internships in product management or social impact. I prefer Kigali, Nairobi, or remote work."

Assistant: "I found 40 opportunities across your active résumé profiles. Your Product résumé produced 10, your Social Impact résumé produced 10, and the remaining 20 were allocated to the strongest matches from both profiles. The top result is Product Intern at [company]. It is an 86% preference and requirement fit. Use Product résumé v2. The main gap is evidence of user research."

### Analyze evidence

Student: "Analyze my portfolio link and tell me what skills it proves."

Assistant: "This is a public portfolio page. I can inspect the project descriptions and work samples for career evidence. I will not access private accounts or claim that you completed work you did not identify. Continue?"

After inspection, the assistant returns:

| Skill | Evidence | Status | Confidence |
| --- | --- | --- | --- |
| User research | Published case study with interviews and findings | AI analyzed; student confirmation needed | Medium |
| Project planning | Project timeline and delivery summary | Student approved | High |
| Presentation | Recorded presentation linked by the student | Self-reported | Medium |

Student: "I only handled the research, not the project planning."

Assistant: "Updated. I removed project planning from your evidence and attached the user-research evidence to your Product résumé. Nothing will be shared with employers until you approve visibility."

### Apply to a role

Student: "Help me apply to the Product Intern role."

Assistant: "Your Product résumé v2 is the strongest match at 84%. It includes your approved user-research case study and product prototype. I drafted a role-specific résumé summary and application response. Review the changes before downloading or submitting."

The assistant must never invent skills, experience, achievements, or responsibilities.

## 7. Employer conversation examples

### Create a role

Employer: "Create a paid hybrid Data Analyst internship in Kigali for ALU students."

Assistant: "I created a draft. Please confirm the deadline, stipend amount, and whether SQL is essential or preferred."

The right panel opens a structured job form. The employer edits and publishes it manually.

### Generate an assessment

Employer: "Create three short practical questions based on this role document."

Assistant: "I drafted three questions. Each question is linked to an approved requirement and includes an editable rubric. The assessment is currently a draft and is not visible to candidates."

The right panel shows question cards, rubric criteria, source references, duration, allowed tools, accessibility options, and buttons for Edit, Regenerate, Preview, Save Draft, and Approve and Publish.

### Review the Smart Shortlist

Employer: "Show the best candidates for this role."

Assistant: "There are 18 applicants. I found 6 candidates with strong evidence against the approved criteria. Candidate A is ranked first because they completed the assessment, have approved evidence for SQL and data cleaning, and match the location and availability preferences. Candidate B has relevant evidence but has not completed the assessment."

The right panel shows candidates in a comparison table with résumé used, requirements met, assessment score, evidence, missing proof, confidence, and human action buttons.

## 8. Tool architecture

The chat interface should call controlled server-side tools rather than perform arbitrary actions:

```
type InternshipAssistantTool =
  | 'search_opportunities'
  | 'compare_resume_profiles'
  | 'explain_match'
  | 'create_resume_draft'
  | 'analyze_student_evidence'
  | 'create_job_draft'
  | 'extract_job_requirements'
  | 'generate_assessment_draft'
  | 'test_assessment'
  | 'get_smart_shortlist'
  | 'compare_candidates'
  | 'prepare_invitation'
  | 'prepare_interview_guide'
  | 'summarize_pipeline'
  | 'get_application_status'
  | 'get_outcome_report'
  | 'inspect_external_link'
  | 'verify_evidence_alignment'
  | 'extract_hidden_requirements'
```

Each tool validates the authenticated user, role, company or university permissions, selected job context, candidate visibility, evidence consent, and required input schema.

## 9. Confirmation policy

The assistant may perform low-risk searches, explanations, drafts, and summaries automatically. It must request confirmation before publishing a job, publishing an assessment, sharing evidence, sending messages, inviting candidates, submitting an application, changing candidate status, or deleting data.

The assistant must never make the final hiring decision. It can recommend **Invite assessment**, **Invite interview**, **Request evidence**, or **Human review**, but the employer must perform and record the final action.

## 10. Link inspection boundaries

The assistant may inspect public HTTPS portfolio pages, public project pages, user-uploaded files, or authorized integrations. It must not bypass authentication, CAPTCHA, paywalls, robots restrictions, or private access controls. It must not request or store passwords. If a page cannot be accessed, it should ask the user to upload the relevant material instead.

Each inspection should record the source URL, access time, content type, extraction status, relevant source references, and consent state. Students must be able to correct, remove, or restrict extracted evidence.

## 11. AI and scoring separation

AI handles document understanding, skill extraction, evidence summaries, question drafts, rubric drafts, explanations, and improvement suggestions. Normal application code controls permissions, fixed-40 allocation, résumé selection, filtering, scoring weights, deduplication, consent, application status, audit logging, and employer decisions.

A match should show separate dimensions:

| Dimension | Meaning |
|---|---|
| Requirement fit | How many approved essential and preferred requirements are supported. |
| Evidence quality | Whether evidence is self-reported, student-approved, or verified. |
| Assessment fit | Performance against the employer-approved rubric. |
| Preference fit | Location, work mode, availability, compensation, and role preferences. |
| Confidence | How complete and reliable the available information is. |
| Readiness | Apply now, close gaps first, or build toward the role. |

## 12. Safety and fairness

The assistant must not infer or use race, gender, age, disability, accent, emotion, personality, facial features, school prestige alone, or protected or proxy characteristics. It must not use hidden candidate data. It must disclose AI use, show evaluation categories, support accommodations, allow correction and appeal, and provide human review.

Assessment evaluation should use only the approved, job-related rubric. Portfolio analysis should distinguish observed evidence from assumptions. Team-project analysis should ask the student to describe their contribution.

## 13. Suggested interface

Use one assistant called **Optryva Internship Assistant** with context-aware modes:

- **Find opportunities** for search and matching.
- **Improve my profile** for résumé and evidence work.
- **Research an opportunity** for company and role questions.
- **Prepare my application** for résumé selection and application drafting.
- **Prepare for assessment** for candidate readiness.
- **Employer Copilot** for role, assessment, shortlist, and pipeline actions.

The user can chat naturally, but the assistant should always display structured cards, buttons, tables, source links, and confirmation panels when appropriate.

## 14. MVP implementation order

First connect the assistant to read-only features: opportunity search, résumé comparison, match explanations, evidence summaries, application status, and employer pipeline summaries. Next add draft actions: job drafts, requirement extraction, assessment questions, rubrics, interview guides, and résumé drafts. Finally add confirmed actions: publish, invite, share evidence, submit applications, change candidate status, and send messages.

The first ALU pilot should use a limited set of commands and measure whether students complete profiles, reuse résumé evidence, receive relevant matches, complete assessments, and obtain interviews. Employers should be measured on screening time, shortlist quality, assessment completion, repeat posting, and hiring outcomes.

## 15. Final product promise

> **Optryva Internship Assistant helps students find the right opportunity, choose the right résumé, prove their skills, close their gaps, and apply. It helps employers define roles, create assessments, inspect evidence, and receive an explainable shortlist—while people remain in control.**
