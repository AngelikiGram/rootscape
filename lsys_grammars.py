import random
import re
import numpy as np

# Token format: S{theta_bin}_{phi_bin}_{len_bin}
NUM_BINS_THETA = 36 # 180 / 36 = 5 deg steps
NUM_BINS_PHI = 36   # 360 / 36 = 10 deg steps
NUM_BINS_F = 10

SPECIES_RULES = {
    "oak": {
        "shoot": {
            "seed": "A",
            "rules": {
                "A": ["S2_0_7 [ S8_14_5 L ] [ S8_32_5 L ] A", "S4_18_6 [ S7_2_4 L ] [ S7_20_4 L ] A"],
                "L": ["S8_5_4 S10_19_3 L", "S8_23_4 S10_1_3 L", "S9_0_3"],
            }
        },
        "root": {
            "seed": "A",
            "rules": {
                "A": ["S35_0_6 [ S22_14_4 L ] [ S22_32_4 L ] A"],
                "L": ["S32_18_3 L"],
            }
        }
    },
    "pine": {
        "shoot": {
            "seed": "A",
            "rules": {
                "A": ["S0_0_8 [ S9_0_5 L ] [ S9_7_5 L ] [ S9_14_5 L ] [ S9_21_5 L ] [ S9_28_5 L ] A"],
                "L": ["S10_0_4 S11_0_3 L"],
            }
        },
        "root": {
            "seed": "A",
            "rules": {
                "A": ["S27_0_6 [ S28_14_5 L ] [ S28_32_5 L ] A"],
                "L": ["S27_18_4 L"],
            }
        }
    },
    "cherry": {
        "shoot": {
            "seed": "A",
            "rules": {
                "A": ["S2_0_6 [ S7_0_4 L ] [ S7_12_4 L ] [ S7_24_4 L ] A"],
                "L": ["S6_0_3 [ S5_6_2 L ] [ S5_30_2 L ]"],
            }
        },
        "root": {
            "seed": "A",
            "rules": {
                "A": ["S30_0_5 [ S24_18_4 L ] A"],
                "L": ["S28_0_3 L"],
            }
        }
    },
    "spruce": {
        "shoot": {
            "seed": "A",
            "rules": {
                "A": ["S0_0_7 [ S6_0_5 L ] [ S6_12_5 L ] [ S6_24_5 L ] A"],
                "L": ["S6_0_4 [ S22_0_3 ] [ S22_18_3 ]"],
            }
        },
        "root": {
            "seed": "A",
            "rules": {
                "A": ["S32_0_6 [ S28_0_4 L ] A"],
                "L": ["S30_18_3 L"],
            }
        }
    },
    "birch": {
        "shoot": {
            "seed": "A",
            "rules": {
                "A": ["S1_0_7 [ S5_0_6 L ] S1_14_7 [ S5_14_6 L ] A"],
                "L": ["S4_0_4 [ S32_0_3 L ]", "S4_18_4 [ S32_18_3 L ]"],
            }
        },
        "root": {
            "seed": "A",
            "rules": {
                "A": ["S34_0_6 [ S26_14_4 L ] A"],
                "L": ["S31_18_3 L"],
            }
        }
    },
    "beech": {
        "shoot": {
            "seed": "A",
            "rules": {
                "A": ["S1_0_8 [ S14_0_6 L ] [ S14_18_6 L ] A"],
                "L": ["S16_0_5 S17_18_4 L", "S16_9_5 S17_27_4 L"],
            }
        },
        "root": {
            "seed": "A",
            "rules": {
                "A": ["S27_0_6 [ S24_14_5 L ] [ S24_32_5 L ] A"],
                "L": ["S26_18_4 L"],
            }
        }
    }
}

def grow_lstring(lstring, species, part_type="shoot"):
    grammar = SPECIES_RULES.get(species, SPECIES_RULES["oak"])
    rules = grammar[part_type]["rules"]
    tokens = re.findall(r'\S+', lstring)
    result = []
    for tok in tokens:
        if tok in rules:
            result.append(random.choice(rules[tok]))
        else:
            result.append(tok)
    return ' '.join(result)

def generate_species_lstring(species, iterations=3, part_type="shoot"):
    grammar = SPECIES_RULES.get(species, SPECIES_RULES["oak"])
    current = grammar[part_type]["seed"]
    for _ in range(iterations):
        current = grow_lstring(current, species, part_type=part_type)
    return current

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--species", type=str, default="oak", choices=list(SPECIES_RULES.keys()))
    parser.add_argument("--iters", type=int, default=3)
    parser.add_argument("--type", type=str, default="shoot", choices=["shoot", "root"])
    args = parser.parse_args()
    print(generate_species_lstring(args.species, args.iters, args.type))
