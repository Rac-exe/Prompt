/**
 * Validation utilities for user input
 */

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validate email format
 */
export function validateEmail(email: string): ValidationResult {
  if (!email || email.trim().length === 0) {
    return { isValid: false, error: 'Email is required' };
  }

  // Basic email regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  if (!emailRegex.test(email)) {
    return { isValid: false, error: 'Invalid email format' };
  }

  if (email.length > 255) {
    return { isValid: false, error: 'Email is too long (max 255 characters)' };
  }

  return { isValid: true };
}

/**
 * Validate password strength
 */
const WEAK_PASSWORDS = new Set([
  'password', '123456', '12345678', 'qwerty', 'abc123', 'monkey', 'master',
  'dragon', 'login', 'letmein', 'welcome', 'shadow', 'sunshine', 'princess',
  'football', 'charlie', 'trustno1', 'iloveyou', 'batman', 'access',
  'passw0rd', 'admin123', 'password1', 'qwerty123', '1234567890',
]);

export function validatePassword(password: string): ValidationResult {
  if (!password || password.length === 0) {
    return { isValid: false, error: 'Password is required' };
  }

  if (password.length < 8) {
    return { isValid: false, error: 'Password must be at least 8 characters' };
  }

  if (password.length > 128) {
    return { isValid: false, error: 'Password is too long (max 128 characters)' };
  }

  if (WEAK_PASSWORDS.has(password.toLowerCase())) {
    return { isValid: false, error: 'This password is too common — please choose a stronger one' };
  }

  if (!/[A-Z]/.test(password)) {
    return { isValid: false, error: 'Password must include at least one uppercase letter' };
  }

  if (!/[a-z]/.test(password)) {
    return { isValid: false, error: 'Password must include at least one lowercase letter' };
  }

  if (!/[0-9]/.test(password)) {
    return { isValid: false, error: 'Password must include at least one number' };
  }

  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password)) {
    return { isValid: false, error: 'Password must include at least one special character (!@#$%^&* etc.)' };
  }

  return { isValid: true };
}

/**
 * Validate name (must not be empty, reasonable length)
 */
export function validateName(name: string): ValidationResult {
  if (!name || name.trim().length === 0) {
    return { isValid: false, error: 'Name is required' };
  }

  if (name.trim().length < 2) {
    return { isValid: false, error: 'Name must be at least 2 characters' };
  }

  if (name.length > 100) {
    return { isValid: false, error: 'Name is too long (max 100 characters)' };
  }

  return { isValid: true };
}

/**
 * Validate date of birth (must be valid date, user must be at least 13 years old)
 */
export function validateDateOfBirth(dob: string): ValidationResult {
  if (!dob || dob.trim().length === 0) {
    return { isValid: false, error: 'Date of birth is required' };
  }

  // Parse date
  const dobDate = new Date(dob);
  
  if (isNaN(dobDate.getTime())) {
    return { isValid: false, error: 'Invalid date format' };
  }

  // Check if date is in the future
  const today = new Date();
  if (dobDate > today) {
    return { isValid: false, error: 'Date of birth cannot be in the future' };
  }

  // Check if user is at least 13 years old
  const age = today.getFullYear() - dobDate.getFullYear();
  const monthDiff = today.getMonth() - dobDate.getMonth();
  const dayDiff = today.getDate() - dobDate.getDate();
  
  let actualAge = age;
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    actualAge--;
  }

  if (actualAge < 13) {
    return { isValid: false, error: 'You must be at least 13 years old' };
  }

  // Check if user is unreasonably old (e.g., over 150 years)
  if (actualAge > 150) {
    return { isValid: false, error: 'Invalid date of birth' };
  }

  return { isValid: true };
}

/**
 * Validate signup data (all fields)
 */
export function validateSignUpData(data: {
  name: string;
  dob: string;
  email: string;
  password: string;
}): ValidationResult {
  // Validate name
  const nameValidation = validateName(data.name);
  if (!nameValidation.isValid) {
    return nameValidation;
  }

  // Validate DOB
  const dobValidation = validateDateOfBirth(data.dob);
  if (!dobValidation.isValid) {
    return dobValidation;
  }

  // Validate email
  const emailValidation = validateEmail(data.email);
  if (!emailValidation.isValid) {
    return emailValidation;
  }

  // Validate password
  const passwordValidation = validatePassword(data.password);
  if (!passwordValidation.isValid) {
    return passwordValidation;
  }

  return { isValid: true };
}

/**
 * Validate signin data (email and password)
 */
export function validateSignInData(data: {
  email: string;
  password: string;
}): ValidationResult {
  // Validate email
  const emailValidation = validateEmail(data.email);
  if (!emailValidation.isValid) {
    return emailValidation;
  }

  // Validate password (just check if not empty)
  if (!data.password || data.password.length === 0) {
    return { isValid: false, error: 'Password is required' };
  }

  return { isValid: true };
}

/**
 * Validate personalization prompt (reasonable length)
 */
export function validatePersonalizationPrompt(prompt: string): ValidationResult {
  if (!prompt || prompt.trim().length === 0) {
    return { isValid: true }; // Empty is okay
  }

  if (prompt.length > 5000) {
    return { isValid: false, error: 'Personalization prompt is too long (max 5000 characters)' };
  }

  return { isValid: true };
}

/**
 * Sanitize string input (remove dangerous characters)
 */
export function sanitizeString(input: string): string {
  if (!input) return '';
  
  // Remove null bytes
  return input.replace(/\0/g, '');
}

/**
 * Validate chat title
 */
export function validateChatTitle(title: string): ValidationResult {
  if (!title || title.trim().length === 0) {
    return { isValid: false, error: 'Chat title is required' };
  }

  if (title.length > 200) {
    return { isValid: false, error: 'Chat title is too long (max 200 characters)' };
  }

  return { isValid: true };
}

/**
 * Validate message content
 */
export function validateMessageContent(content: string): ValidationResult {
  if (!content || content.trim().length === 0) {
    return { isValid: false, error: 'Message content is required' };
  }

  if (content.length > 50000) {
    return { isValid: false, error: 'Message is too long (max 50000 characters)' };
  }

  return { isValid: true };
}
