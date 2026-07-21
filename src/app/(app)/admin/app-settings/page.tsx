'use client';

import { useState, useEffect } from 'react';
import { PageHeading } from "@/components/page-heading";

type ThemeOption = 'classic' | 'detroit' | 'emerald';

const THEMES = [
  {
    id: 'classic',
    name: 'Plum Classic',
    primary: 'bg-[#1B365D]',
    secondary: 'bg-[#0D9488]',
    accent: 'bg-[#E67E22]',
  },
  {
    id: 'detroit',
    name: 'Motor City Slate',
    primary: 'bg-[#1e293b]',
    secondary: 'bg-[#0ea5e9]',
    accent: 'bg-[#f59e0b]',
  },
  {
    id: 'emerald',
    name: 'Emerald Executive',
    primary: 'bg-[#064e3b]',
    secondary: 'bg-[#10b981]',
    accent: 'bg-[#f97316]',
  },
];

export default function AppSettingsPage() {
  const [activeTheme, setActiveTheme] = useState<ThemeOption>('classic');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const savedTheme = (localStorage.getItem('plumworks_theme') as ThemeOption) || 'classic';
    setActiveTheme(savedTheme);
  }, []);

  const handleThemeChange = (themeId: ThemeOption) => {
    setActiveTheme(themeId);
    localStorage.setItem('plumworks_theme', themeId);
    document.documentElement.setAttribute('data-theme', themeId);
  };

  if (!mounted) return null;

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeading
        eyebrow="Preferences"
        title="App Settings"
        description="Customize the appearance and behavior of your workspace."
      />

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-bold text-slate-900 mb-1">Color Theme</h2>
        <p className="text-sm text-slate-500 font-medium mb-6">Choose a visual style for your shop.</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              onClick={() => handleThemeChange(theme.id as ThemeOption)}
              className={`group flex flex-col p-4 rounded-xl border transition-all duration-200 text-left ${
                activeTheme === theme.id 
                  ? 'border-brand-primary bg-brand-subtle ring-1 ring-brand-primary' 
                  : 'border-slate-200 bg-white hover:border-brand-primary/30 hover:shadow-sm'
              }`}
            >
              <div className="flex items-center justify-between mb-4 w-full">
                <span className={`font-bold ${activeTheme === theme.id ? 'text-brand-primary' : 'text-slate-700 group-hover:text-brand-primary'}`}>
                  {theme.name}
                </span>
                {activeTheme === theme.id && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-primary text-white">
                    <svg viewBox="0 0 14 14" fill="none" className="h-3 w-3" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2.5 7.5L5.5 10.5L11.5 3.5" />
                    </svg>
                  </span>
                )}
              </div>
              
              <div className="flex gap-2 rounded-lg border border-slate-100 bg-slate-50 p-2">
                <div className={`h-8 w-full rounded-md shadow-sm ${theme.primary}`} title="Primary" />
                <div className={`h-8 w-1/3 rounded-md shadow-sm ${theme.secondary}`} title="Secondary" />
                <div className={`h-8 w-1/3 rounded-md shadow-sm ${theme.accent}`} title="Accent" />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}