export const marketingServices = [
  { slug: "brakes", name: "Brake Service", summary: "Inspection and repair for confident, controlled stops.", detail: "Brake concerns deserve a careful look. We inspect the system, explain what we find, and provide a clear estimate before authorized work begins." },
  { slug: "oil-change", name: "Oil Changes", summary: "Routine oil and filter service built around your vehicle.", detail: "Regular oil service supports engine life and gives us a chance to notice developing maintenance needs without turning every visit into a sales pitch." },
  { slug: "diagnostics", name: "Diagnostics", summary: "Thoughtful testing for warning lights and drivability concerns.", detail: "Good diagnostics starts with listening. We document the concern, test methodically, and share the evidence behind our recommendation." },
  { slug: "ac-repair", name: "A/C Repair", summary: "Climate-control testing and repair for year-round comfort.", detail: "We evaluate system performance, look for the cause of lost cooling, and discuss practical repair options before proceeding." },
  { slug: "suspension-steering", name: "Suspension & Steering", summary: "Help for noises, uneven handling, and ride-quality concerns.", detail: "Steering and suspension components work together. A focused inspection helps separate urgent safety concerns from items that can be planned." },
  { slug: "battery-electrical", name: "Battery & Electrical", summary: "Starting, charging, battery, and common electrical diagnosis.", detail: "We test the system instead of guessing at parts, then explain whether the battery, charging system, connections, or another circuit needs attention." },
  { slug: "tires", name: "Tire Service", summary: "Tire condition checks, rotation, repair guidance, and replacement help.", detail: "Tires connect every drive to the road. We help evaluate wear, pressure, damage, and replacement timing with your driving needs in mind." },
  { slug: "maintenance", name: "Preventive Maintenance", summary: "A practical plan based on mileage, condition, and priorities.", detail: "Maintenance should feel manageable. We help organize services by timing and importance so you can make an informed plan for your vehicle." },
] as const;

export function findMarketingService(slug: string) {
  return marketingServices.find((service) => service.slug === slug);
}
