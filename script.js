document.addEventListener('DOMContentLoaded', () => {
    const calculateBtn = document.getElementById('calculateBtn');
    const resultDiv = document.getElementById('result');
    const voltageInput = document.getElementById('voltage');
    const currentInput = document.getElementById('current');
    const materialSelect = document.getElementById('material');
    const wireSizeSelect = document.getElementById('wireSize');
    const lengthInput = document.getElementById('length');
    const phaseSelect = document.getElementById('phase');
    const targetVDPercentInput = document.getElementById('targetVDPercent');

    // --- Standard Wire Sizes (AWG/kcmil) and their Circular Mil Area (CMA) ---
    const wireData = {
        // AWG (Smaller to Larger CMA)
        "18": 1620,   "16": 2580,   "14": 4110,   "12": 6530,   "10": 10380,
        "8": 16510,    "6": 26240,    "4": 41740,    "3": 52620,    "2": 66360,
        "1": 83690,    "1/0": 105600, "2/0": 133100, "3/0": 167800, "4/0": 211600,
        // kcmil (Smaller to Larger CMA)
        "250": 250000, "300": 300000, "350": 350000, "400": 400000, "500": 500000,
        "600": 600000, "750": 750000, "1000": 1000000,
    };

    // --- Create a sorted list of wire sizes for finding the minimum required ---
    // Sorts primarily by CMA, ensuring we find the smallest adequate size
    const sortedWireSizes = Object.entries(wireData) // [['18', 1620], ['16', 2580], ...]
                               .sort(([, cmaA], [, cmaB]) => cmaA - cmaB); // Sort by CMA value

    // --- Populate Wire Size Dropdown ---
    function populateWireSizes() {
        // Clear existing options except the placeholder
        wireSizeSelect.querySelectorAll('option:not([value=""])').forEach(option => option.remove());

        const awgOrder = ["18", "16", "14", "12", "10", "8", "6", "4", "3", "2", "1", "1/0", "2/0", "3/0", "4/0"];
        awgOrder.forEach(size => {
            if (wireData[size]) {
                const option = document.createElement('option');
                option.value = size;
                option.textContent = `${size} AWG`;
                wireSizeSelect.appendChild(option);
            }
        });
        Object.keys(wireData).forEach(size => {
             // Add only if it's a kcmil size (simple check) and not already added
             const isKcmil = /^\d+$/.test(size) && parseInt(size) >= 250;
             if (isKcmil && !awgOrder.includes(size)) { // Check if it's kcmil and wasn't in AWG list
                const option = document.createElement('option');
                option.value = size;
                option.textContent = `${size} kcmil`;
                wireSizeSelect.appendChild(option);
            }
        });
    }

    // --- Calculation Logic ---
    function calculateVoltageDrop() {
        resultDiv.innerHTML = ''; // Clear previous results
        resultDiv.classList.remove('error'); // Clear error styling

        // Get Input Values
        const voltage = parseFloat(voltageInput.value);
        const current = parseFloat(currentInput.value);
        const material = materialSelect.value;
        const wireSizeKey = wireSizeSelect.value; // Can be ""
        const lengthStr = lengthInput.value.trim();
        const length = lengthStr ? parseFloat(lengthStr) : null; // Keep as null if blank
        const phase = phaseSelect.value;
        const targetVDPercent = parseFloat(targetVDPercentInput.value) || 3.0; // Default to 3% if blank/invalid

        // --- Basic Input Validation ---
        if (isNaN(voltage) || voltage <= 0) {
            showError('Please enter a valid positive Source Voltage.');
            return;
        }
        if (isNaN(current) || current < 0) { // Allow 0 current, though VD will be 0
             showError('Please enter a valid Current (Amps).');
             return;
        }
         if (isNaN(targetVDPercent) || targetVDPercent <= 0 || targetVDPercent >= 100) {
             showError('Please enter a valid Target Max Voltage Drop % (e.g., 1-10).');
             return;
         }

        // --- Determine Calculation Mode ---
        const isCalculatingVD = wireSizeKey && (length !== null && !isNaN(length));
        const isFindingSize = !wireSizeKey && (length !== null && !isNaN(length) && length > 0);
        const isFindingLength = wireSizeKey && (length === null || lengthStr === '');

        // --- Constants ---
        const K = (material === 'copper') ? 12.9 : 21.2; // Ohms-cmil/ft (approx @ 75°C)
        const phaseFactor = (phase === 'single') ? 2 : Math.sqrt(3); // Approx 1.732 for 3-phase
        const targetVD_Volts = voltage * (targetVDPercent / 100);

        // --- Perform Calculation Based on Mode ---

        if (isCalculatingVD) {
            // MODE 1: Calculate Voltage Drop (Both Size and Length provided)
             if (length <= 0) {
                 showError("Please enter a positive Length when calculating Voltage Drop.");
                 return;
             }
            const CMA = wireData[wireSizeKey];
            if (!CMA) {
                showError("Selected wire size data not found."); return; // Should not happen with dropdown
            }

            const voltageDrop = (phaseFactor * K * length * current) / CMA;
            const voltageDropPercent = (voltageDrop / voltage) * 100;
            const voltageAtLoad = voltage - voltageDrop;
            const wireLabel = getWireLabel(wireSizeKey);

            displayResults(`
                <p><strong>Calculation Mode:</strong> Voltage Drop</p>
                <p><strong>Wire Size:</strong> ${wireSizeKey} ${wireLabel} (${material})</p>
                <p><strong>Length:</strong> ${length} ft</p>
                <hr style='border-color: var(--border-color); opacity: 0.5; margin: 10px 0;'>
                <p><strong>Voltage Drop:</strong> ${voltageDrop.toFixed(2)} Volts</p>
                <p><strong>Voltage Drop Percentage:</strong> ${voltageDropPercent.toFixed(2)} %</p>
                <p><strong>Voltage at Load:</strong> ${voltageAtLoad.toFixed(2)} Volts</p>
            `, voltageDropPercent > targetVDPercent ? `Warning: Voltage drop (${voltageDropPercent.toFixed(2)}%) exceeds target (${targetVDPercent}%).` : null);


        } else if (isFindingSize) {
            // MODE 2: Find Recommended Wire Size (Length provided, Wire Size blank)
             if (current <= 0) {
                showError("Current must be greater than 0 to calculate recommended wire size.");
                return;
             }
             if (length <= 0) {
                 showError("Length must be greater than 0 to calculate recommended wire size.");
                 return;
             }

            // Formula: CMA_min = (PhaseFactor * K * L * I) / VD_max_volts
            const minCMA = (phaseFactor * K * length * current) / targetVD_Volts;

            let recommendedSize = null;
            let actualCMA = null; // Still needed internally for VD% calculation

            // Find the first wire size in the sorted list with CMA >= minCMA
            for (const [sizeKey, cmaValue] of sortedWireSizes) {
                if (cmaValue >= minCMA) {
                    recommendedSize = sizeKey;
                    actualCMA = cmaValue; // Assign the CMA of the found size
                    break; // Found the smallest adequate size
                }
            }

            if (recommendedSize) {
                 // Recalculate actual VD% with the chosen size's CMA
                 const actualVD = (phaseFactor * K * length * current) / actualCMA;
                 const actualVDPercent = (actualVD / voltage) * 100;
                 const wireLabel = getWireLabel(recommendedSize);

                 // Display results WITHOUT CMA values
                 displayResults(`
                    <p><strong>Calculation Mode:</strong> Find Recommended Wire Size</p>
                    <p><strong>Target Max VD:</strong> ${targetVDPercent.toFixed(1)}% (${targetVD_Volts.toFixed(2)} V)</p>
                    <p><strong>Length:</strong> ${length} ft</p>
                    <hr style='border-color: var(--border-color); opacity: 0.5; margin: 10px 0;'>
                    <p><strong>Recommended Size (${material}):</strong> ${recommendedSize} ${wireLabel}</p>
                    <p><strong>Calculated VD% with this size:</strong> ${actualVDPercent.toFixed(2)}%</p>
                 `);
            } else {
                 // Updated error message as Min CMA isn't displayed directly anymore
                 showError(`No standard wire size found for ${targetVDPercent}% target VD. Calculation requires a minimum CMA of ${minCMA.toFixed(0)}.`);
            }


        } else if (isFindingLength) {
            // MODE 3: Find Maximum Length (Wire Size provided, Length blank)
             if (current <= 0) {
                showError("Current must be greater than 0 to calculate maximum length.");
                return;
             }

            const CMA = wireData[wireSizeKey];
             if (!CMA) {
                 showError("Selected wire size data not found."); return; // Should not happen with dropdown
             }
             const wireLabel = getWireLabel(wireSizeKey);

            // Formula: L_max = (VD_max_volts * CMA) / (PhaseFactor * K * I)
            const maxLength = (targetVD_Volts * CMA) / (phaseFactor * K * current);

             displayResults(`
                <p><strong>Calculation Mode:</strong> Find Maximum Length</p>
                <p><strong>Target Max VD:</strong> ${targetVDPercent.toFixed(1)}% (${targetVD_Volts.toFixed(2)} V)</p>
                <p><strong>Wire Size:</strong> ${wireSizeKey} ${wireLabel} (${material})</p>
                <hr style='border-color: var(--border-color); opacity: 0.5; margin: 10px 0;'>
                <p><strong>Maximum One-Way Length:</strong> ${maxLength.toFixed(1)} Feet</p>
            `);


        } else {
            // MODE 4: Invalid Combination or Missing Inputs
            if (!wireSizeKey && (length === null || lengthStr === '')) {
                 showError('Please provide EITHER a Wire Size OR a Length in the "Adjustable Parameters" section.');
            } else if (length !== null && length <= 0 && isFindingSize) {
                 showError("Please enter a positive Length to calculate recommended wire size.");
            }
             else {
                 showError('Invalid input combination. Please check your entries.'); // General fallback
            }
        }
    }

    // --- Helper function to display results ---
    function displayResults(innerHTML, warning = null) {
        resultDiv.innerHTML = innerHTML;
        if (warning) {
            const warningP = document.createElement('p');
            // Use a CSS class for styling the warning (defined in style.css)
            warningP.className = 'warning-message';
            warningP.textContent = warning;
            resultDiv.appendChild(warningP);
        }
    }

    // --- Helper function to show errors ---
    function showError(message) {
         resultDiv.innerHTML = `<p>${message}</p>`;
         resultDiv.classList.add('error'); // Apply error styling via CSS class
    }

    // --- Helper function to get AWG/kcmil label ---
    function getWireLabel(sizeKey) {
        if (!sizeKey) return '';
        // Basic check: if it's purely numeric and >= 250, assume kcmil
        const isKcmil = /^\d+$/.test(sizeKey) && parseInt(sizeKey) >= 250;
        return isKcmil ? 'kcmil' : 'AWG';
    }


    // --- Initialize ---
    populateWireSizes(); // Fill the dropdown on page load
    calculateBtn.addEventListener('click', calculateVoltageDrop); // Attach calculation function to button click

}); // End DOMContentLoaded