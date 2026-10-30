export function configurationEvidence({ signatureDefaults, securitySettings }) {
  return {
    shopSignatureDefaults: signatureDefaults == null ? null : {
      representative_name: signatureDefaults.representative_name,
      signature_sha256: signatureDefaults.signature_sha256,
      updated_by: signatureDefaults.updated_by,
    },
    shopSecuritySettings: securitySettings == null ? null : {
      mfa_required: securitySettings.mfa_required,
    },
  };
}
